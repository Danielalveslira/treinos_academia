# Evolutus — Profissionais, Espaços e Vitrine de Produtos

**Documento de produto e arquitetura para uma implementação isolada**
**Status:** proposta para auditoria e aprovação; nenhuma alteração de código, Firebase ou produção autorizada por este documento.
**Projeto:** Evolutus · aplicativo gratuito de treinos, progresso e comunidades.
**Modelo de negócio:** publicidade comercial + EvoCash para recursos opcionais de visibilidade.

## 1. Visão do produto

Criar uma área chamada **Profissionais & Espaços**, acessível a quem usa o Evolutus, na qual seja possível descobrir profissionais de educação física e modalidades esportivas, academias, boxes, estúdios e serviços relacionados ao treino. Cada participante poderá manter uma **vitrine pública** com apresentação, especialidades, contato, comunidade associada e, quando aplicável, um pequeno catálogo de produtos ou serviços.

O Evolutus deve continuar gratuito para registrar treinos, acompanhar progresso, participar de comunidades, encontrar perfis e consultar informações básicas. A monetização virá da **visibilidade adicional opcional**, adquirida com EvoCash, e de anúncios comerciais administrados separadamente. Nunca condicionar a utilidade básica do aplicativo à compra de créditos.

**Proposta central:** descobrir → conhecer o perfil → acessar comunidade/contato → eventualmente contratar fora da plataforma. A V1 não intermedeia pagamento, agendamento, entrega, transferência de dinheiro ou venda de produtos.

## 2. Público e categorias

Separar a descoberta em duas abas ou filtros claros:

- **Profissionais:** personal trainers, professores de musculação, preparação física, funcional, corrida, caratê, judô, jiu-jítsu, boxe, muay thai, yoga, dança e outras modalidades pertinentes.
- **Espaços:** academias, boxes, centros de treinamento, estúdios, escolas de artes marciais e outros locais de prática.

Uma pessoa pode ter conta pessoal, perfil profissional e comunidade vinculada, mas esses conceitos devem ter **dados e permissões distintos**. Perfil profissional não concede superadmin. Um espaço pode ter responsável/gestor verificado, conforme política administrativa própria.

A descoberta deve funcionar por busca, categoria/modalidade, cidade/UF, presencial/online e filtros simples. Localização precisa do usuário não é requisito: usar cidade/UF informadas voluntariamente e não publicar endereço residencial.

## 3. Experiência do usuário — diretório

Página conceitual: `/profissionais` ou `/explorar-profissionais` (confirmar nomenclatura e rotas disponíveis antes de implementar).

Elementos:

1. Título: **Encontre quem impulsiona sua evolução.**
2. Busca por nome, modalidade, serviço ou cidade.
3. Filtros: Profissionais | Espaços; modalidade; cidade/UF; presencial/online.
4. Área **Em destaque** explicitamente marcada como `Patrocinado`, separada dos resultados orgânicos.
5. Resultados orgânicos navegáveis, paginados e com estado vazio apropriado.
6. Cada card: foto/logotipo, nome, categoria, cidade, modalidade, atendimento e ação `Ver perfil`.

Não prometer classificação por qualidade, resultados de treino, proximidade exata ou reputação verificada quando não houver dados confiáveis. O destaque pago **não é certificado profissional nem recomendação técnica**.

### Exemplo de card

```text
[Foto]  João Silva                 [Patrocinado, se aplicável]
        Personal trainer
        Musculação · Atendimento presencial/online
        Cidade/UF
        [Ver perfil]
```

## 4. Perfil público profissional / do espaço

URL compartilhável e estável, por exemplo `/profissionais/:slug` ou `/espacos/:slug` (apenas exemplos; verificar conflitos e estratégia de slug/ID antes da implementação).

Campos sugeridos:

- Foto/logotipo, imagem de capa, nome profissional/comercial e apresentação.
- Categoria, modalidades, especialidades e formato de atendimento.
- Cidade/UF; endereço comercial **apenas quando fornecido e autorizado** pelo responsável.
- Serviços oferecidos, com descrição e preço opcional informado pelo próprio anunciante; caso não informado, `Consultar`.
- Contato público escolhido pelo titular (WhatsApp comercial, site ou rede social), com links seguros.
- Credenciais profissionais pertinentes, número de registro quando aplicável e **estado de verificação administrativa separado de publicidade**.
- Comunidade vinculada, com botão `Ver comunidade`, somente após comprovar controle/autorização sobre o vínculo.
- Produtos/serviços anunciados no catálogo, quando habilitados.

Nunca exibir e-mail de login, telefone privado, localização residencial, dados financeiros, UID técnico ou informações administrativas. O usuário deve poder editar, despublicar e solicitar remoção de seus dados da vitrine, respeitadas as regras de retenção aplicáveis.

### Identidade visual

Manter dark mode, verde do Evolutus, bordas discretas, bastante respiro, foco em foto/descrição/CTA e layout mobile-first. Não criar aparência de marketplace complexo. O perfil deve ser útil e compartilhável mesmo sem pagar nada.

## 5. Vitrine de produtos e serviços

O titular pode cadastrar itens associados ao seu perfil/estabelecimento. Exemplos: aula experimental, consultoria, plano de treino oferecido pelo profissional, acessórios, vestuário, serviços do espaço e outros itens permitidos pela política da plataforma.

Cada item deve conter:

- Título, categoria, descrição curta e foto(s) em quantidade limitada.
- Preço opcional, com apresentação clara quando informado; alternativamente `Consultar valor`.
- Disponibilidade/estado (`ativo`, `indisponível`, `oculto`).
- Botão `Consultar` / `Falar com o vendedor`, que leva ao canal externo autorizado.
- Identificação do profissional/espaço responsável.

**V1 = catálogo e geração de contato, não e-commerce.** O Evolutus não deve apresentar botão `Comprar agora` com aparência de pagamento interno nem afirmar que processa o pedido, garante entrega, garante autenticidade ou recebeu o valor. Toda compra/contratação ocorre fora da plataforma, com aviso claro quando necessário. Pagamento interno, carrinho, frete, comissão, estorno e atendimento de disputas ficam para uma decisão futura separada.

Exigir moderação/revisão das categorias permitidas; não abrir publicidade irrestrita de itens controlados, perigosos, ilegais ou proibidos pelas regras da plataforma. Criar mecanismo para denúncia, ocultação e remoção administrativa.

## 6. Como o EvoCash entra — monetização recorrente e opcional

O EvoCash já é um crédito interno comprado com dinheiro real, com carteira, ledger, idempotência e cobrança server-side. Reaproveitar a infraestrutura existente. **Não criar uma segunda carteira, conversão Coin→Cash, transferência, saque ou crédito financeiro por vendas.**

A compra recorrente deve ser motivada por **campanhas opcionais de duração limitada**, não por travar o perfil básico, ocultar resultados orgânicos ou fabricar urgência. Quando uma campanha termina, o titular pode comprar outra com saldo existente ou adquirir mais EvoCash voluntariamente. Sem renovação automática/cobrança surpresa na V1.

### 6.1 Promoção de perfil

Dono do perfil pode selecionar `Impulsionar perfil` e escolher um pacote de exposição. O perfil continua gratuito e pesquisável mesmo sem promoção.

Possíveis posicionamentos:

- Seção `Perfis em destaque` no diretório.
- Selo `Patrocinado` nos cards destacados.
- Ordenação/rodízio patrocinado dentro de espaço limitado, com resultados orgânicos preservados.

O pacote compra **posição publicitária durante um período**, não número garantido de clientes, contratos, seguidores ou visualizações. Não confundir `Verificado` com `Patrocinado`.

### 6.2 Promoção de item do catálogo

Dono pode escolher um produto/serviço publicado e clicar `Impulsionar item`.

Possíveis posicionamentos:

- Bloco `Produtos e serviços em destaque` na vitrine.
- Destaque no perfil do próprio titular, identificado quando patrocinado.
- Contexto de categoria/modalidade correspondente, se a arquitetura permitir sem tracking sensível.

O item deve estar publicado, autorizado e pertencer ao solicitante. Ocultar/suspender o item deve interromper sua exibição promocional segundo política explícita de cancelamento/estorno.

### 6.3 Proposta de preços para validação — NÃO configurar automaticamente

O catálogo vigente de compras EvoCash deve ser reutilizado e lido da configuração real do sistema. Referência dos pacotes aprovados anteriormente: **25 = R$ 5,90; 50 = R$ 10,90; 120 = R$ 23,90; 300 = R$ 49,90**. Confirmar valores atuais antes de exibir qualquer tabela comercial.

Valores abaixo são apenas **hipóteses iniciais de produto**, para validação e aprovação antes de alterar `economyConfig`:

| Produto promocional | Prazo | Custo proposto | Observação |
|---|---:|---:|---|
| Impulsionar produto/serviço | 7 dias | 25 EvoCash | Entrada acessível para experimentar |
| Impulsionar produto/serviço | 30 dias | 90 EvoCash | Campanha prolongada, sem renovação automática |
| Impulsionar perfil profissional/espaço | 7 dias | 50 EvoCash | Visibilidade em seção patrocinada |
| Impulsionar perfil profissional/espaço | 30 dias | 180 EvoCash | Presença por prazo maior |

O valor é debitado uma vez por campanha aprovada/ativada; o cliente pode combinar saldo de compras anteriores. **Não exigir a compra de um pacote específico quando já houver saldo suficiente.** Exibir custo, saldo atual, prazo exato, posicionamento e termos antes da confirmação. Respeitar o snapshot do pacote e a operação atômica de débito/ledger/promoção.

Não mexer nos pacotes de promoção já existentes para posts e comunidades; adicionar novos SKUs imutáveis com IDs distintos e compatibilidade retroativa. Não utilizar a quantidade de EvoCash comprada como classificação de qualidade do profissional.

### 6.4 Regras econômicas e antifraude

- Autoridade 100% backend/Admin SDK para preço, saldo, propriedade, status e duração; client envia só IDs/SKU.
- Debitar carteira, gerar ledger determinístico e criar promoção na mesma transação idempotente.
- Uma promoção ativa por alvo, conforme o padrão atual, sem empilhamento ou extensão implícita; definir claramente como iniciar uma nova campanha após expiração.
- Período efetivo derivado de timestamps do servidor, sem depender de cron para definir se está ativo.
- Bloquear anúncio de perfil/item suspenso, não publicado ou sem titular autorizado.
- Cancelamento, suspensão e eventual reembolso precisam de política explícita, exibida antes da compra; preservar as regras já existentes onde aplicável, sem prometer estorno automático.
- Rotação justa entre patrocinados; não tornar a descoberta orgânica inútil.
- Limites por perfil, item, frequência e espaços publicitários para evitar spam/saturação.
- Compra de EvoCash nunca gera credencial profissional, reputação, voto positivo, participação ou colocação em ranking orgânico.

### 6.5 Mensuração para sustentar renovação

Painel `Minhas campanhas` por titular com status, início/fim, período restante, custo em EvoCash e resultados **realmente medidos**. Priorizar cliques de perfil, cliques de contato e cliques de item com agregação e proteção básica contra abuso. Impressões e CTR só devem aparecer quando houver instrumentação válida e definições claras — não inventar números nem dizer que houve venda/conversão externa sem integração de dados. Evitar tracking individual desnecessário.

A receita recorrente desejada vem de o anunciante observar utilidade e optar por renovar, não de mecanismos de consumo artificial de créditos.

## 7. Separação de monetização existente

| Modalidade | Quem usa | Onde aparece | Sistema |
|---|---|---|---|
| Anúncio patrocinado comercial | Empresas contratantes | Banners/cards atuais | `sponsoredAds`, gestão superadmin |
| Promoção de post/comunidade | Usuários/gestores elegíveis | Destaques atuais | Promoções com EvoCash existentes |
| Promoção de perfil | Dono do perfil aprovado | Diretório de profissionais/espaços | Nova modalidade de `promotions` com EvoCash |
| Promoção de produto/serviço | Dono do item aprovado | Vitrine de itens | Nova modalidade de `promotions` com EvoCash |

Não fundir campanhas comerciais externas com as promoções pagas em EvoCash. Reaproveitar o motor de promoções apenas após auditar validações, esquema de targets, queries de exposição e limites.

## 8. Administração, confiança e moderação

Criar fluxo de solicitação/cadastro, revisão, publicação, edição, suspensão e denúncia. A publicação inicial pode exigir aprovação administrativa, especialmente para credenciais e produtos. Definir estados como `draft`, `pending_review`, `published`, `suspended` e `archived`, evitando misturar aprovação com promoção.

A verificação profissional deve ser uma decisão administrativa real, com critérios claros para a categoria aplicável. `Patrocinado` identifica compra de destaque; `Verificado` identifica verificação, nunca um substitui o outro. Não prometer resultados profissionais ou físicos.

Prever tratamento de reclamações, links perigosos, imagens impróprias, publicidade enganosa, produtos vedados e remoção/desativação. Alterações de dados sensíveis de perfil ou produto podem exigir reavaliação. Restringir dados privados na resposta pública das APIs.

## 9. Esboço técnico — sujeito à auditoria do repositório

**Não adotar cegamente nomes de coleções/rotas abaixo.** Primeiro mapear os padrões atuais, `users`, `publicProfiles`, `communities`, `promotions`, `economyConfig`, armazenamento de fotos, moderação e serviços de resolução de usernames.

Possível modelagem:

```text
professionalListings/{listingId}
  ownerId
  kind: professional | space
  slug
  displayName
  category / modalities
  city / uf / serviceMode
  publicContact
  bio / cover / image
  credentials / verificationStatus (campos publicamente sanitizados)
  linkedCommunityId?
  publicationStatus
  promoted / promotedUntil / activePromotionId (server-managed)
  createdAt / updatedAt

professionalListings/{listingId}/items/{itemId}
  ownerId (se necessário para Rules)
  title / description / images / category
  priceCentavos? / priceLabel?
  publicationStatus
  promoted / promotedUntil / activePromotionId (server-managed)
  createdAt / updatedAt

promotions/{promotionId}
  targetType: professional_profile | catalog_item | (tipos existentes)
  targetId / ownerId / package snapshot / timestamps / ledger reference
```

Antes de implementar, definir fonte de verdade e estratégia de consulta por filtros, índice, paginação e promoção. Não fazer varredura de todos os perfis/produtos no cliente nem N+1 de donos. Fotos com limites de tamanho/formato e política de remoção. Preservar regras de exclusão de conta, denúncia e evidência de moderação.

Leituras públicas somente para perfis/itens aprovados/publicados. Escritas sensíveis (aprovação, verificação, saldo, promoção) apenas pelo backend autorizado. Não confiar em `ownerId`, `price`, `promotedUntil`, `verified` ou `status` enviados pelo frontend.

## 10. Rotas e telas previstas

**Público/usuário:** diretório, detalhe do profissional/espaço, lista/detalhe de produtos ou serviços, contato externo, comunidade vinculada, compartilhamento.

**Titular:** `Minha vitrine` (criar/editar), `Produtos e serviços`, `Impulsionar perfil`, `Impulsionar item`, `Minhas campanhas` e estados claros de revisão.

**Admin:** fila de aprovação, verificação, denúncias, suspensão, revisão de itens e visibilidade/estado das promoções (sem editar carteira diretamente).

Criar entradas de navegação proporcionais ao uso; não lotar o header. Pensar em acesso pelo menu/área de exploração. Mobile-first.

## 11. Plano de implementação isolada

### Etapa 0 — Auditoria e desenho (obrigatória, sem código)

Mapear código e regras existentes; verificar conflito de rotas, tipos de promoção, infraestrutura de anúncios, perfil/owner, custo das consultas, storage, segurança, métricas e fluxo administrativo. Entregar decisões pendentes, riscos, arquivos afetados e plano de migração/compatibilidade. **Parar para aprovação antes de implementar.**

### Etapa 1 — Diretório e perfil básico gratuito

Busca/filtros limitados, criação/edição, publicação/revisão, página pública, compartilhamento, contato e comunidade vinculada. Sem EvoCash nesta etapa, garantindo utilidade orgânica.

### Etapa 2 — Catálogo simples

Produtos/serviços associados ao perfil, cadastro e moderação, botão de contato externo, sem checkout nem pagamento pelo app.

### Etapa 3 — EvoCash para impulsionamento

Novos SKUs/configuração, promoção de perfil e item, atomicidade, ledger, idempotência, UI de compra/resultado, exposição com `Patrocinado`, rotação e cancelamento. Preços só após aprovação explícita.

### Etapa 4 — Métricas e piloto comercial

Medição agregada confiável, painel de campanhas, revisão de preços e distribuição, teste com profissionais/estabelecimentos fundadores locais. Sem promessas de retorno ou números fictícios.

**V2 futura:** avaliações com critérios antifraude, disponibilidade/solicitação de orçamento, agenda, painéis de interesse. **V3 somente se houver validação:** agendamento/pagamentos na plataforma, com projeto jurídico/financeiro e operacional independente.

## 12. Testes indispensáveis

- Um usuário comum não altera vitrine de outro; superadmin tem ações apenas nos escopos autorizados.
- Perfil rascunho/suspenso não aparece publicamente nem pode ser promovido.
- Perfil sem pagamento continua pesquisável.
- Vínculo com comunidade exige controle/autorização real.
- Credencial/verificação não pode ser autodeclarada como selo oficial.
- Itens pertencem à vitrine correta; contato externo e URLs passam por validação.
- Produto oculto/suspenso não aparece em resultados nem em promoções.
- Promoção cobra exatamente o SKU aprovado; replay idempotente não duplica débito.
- Troca de estado do alvo invalida exposição; sem promessa implícita de reembolso.
- Rotação patrocinada não substitui integralmente resultados orgânicos.
- Perfil pago não recebe privilégio de superadmin, selo de verificado ou reputação fictícia.
- Filtros, índices, paginação, estados vazios, cache, logout/troca de usuário e mobile.
- Sem leaks de informações privadas em endpoints, Rules e respostas públicas.

## 13. Entregável pedido ao Claude/Codex agora

1. Ler integralmente este documento e mapear o estado atual do Evolutus.
2. Produzir um **relatório de viabilidade e desenho técnico** com decisões de produto ainda abertas, custo estimado de Firestore/Functions, segurança, modelos de dados, rotas, testes e fases.
3. Indicar quais partes podem reutilizar `promotions`, `economyConfig`, `sponsoredAds`, `publicProfiles` e infraestrutura de comunidades.
4. Propor um MVP enxuto e isolado, evitando alterações em treinos, progresso e fluxos financeiros já existentes.
5. **Não editar, não executar migração, não cadastrar produtos/chaves reais, não alterar produção, não fazer commit/push/deploy.** A implementação começa só depois de aprovação explícita.

**Critério de sucesso:** um usuário encontra profissionais e espaços úteis gratuitamente; um profissional mantém uma vitrine confiável; pode divulgar serviços/itens e escolher pagar por exposição adicional com EvoCash, em campanhas transparentes e renováveis, sem afetar a integridade da economia do app.
