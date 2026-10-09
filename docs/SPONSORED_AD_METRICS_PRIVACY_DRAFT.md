# Rascunho — alteração da Política de Privacidade para métricas de patrocinados

> **Rascunho para revisão humana/jurídica. Nada foi publicado.** Os arquivos de `legal/` (`documents.json`,
> `manifest.json`, `approved-digests.json`) **não foram alterados**. Publicar uma nova versão muda o digest da política e
> exige novo aceite de todos os usuários (`has_app_access()` compara versão e digest); por isso a publicação e o
> momento do reaceite são decisões suas, depois da revisão.

## 1. O que o sistema faz (fatos para quem revisa)

Para os anúncios "Patrocinado" (banner da Home, banner da comunidade e card no feed), o app registra:

| Dado | Finalidade | Prazo |
|---|---|---|
| Contagem agregada **por anúncio, posição, comunidade/Home e dia**: impressões visíveis, alcance único e cliques | Acompanhar o desempenho dos patrocínios e reportar ao parceiro (estimativa operacional, **não** base de cobrança) | 24 meses |
| Marcador temporário **(conta, anúncio, posição, comunidade, dia, tipo de evento, código aleatório do evento)** | Não contar duas vezes o mesmo evento reenviado, contar o alcance único do dia e limitar abuso | até 48 horas, depois apagado automaticamente |

- Os agregados **não identificam pessoas** e só o superadmin os lê. Patrocinadores **não** têm acesso nesta fase.
- O marcador temporário liga a conta ao evento por, no máximo, 48 h; **nenhum histórico individual permanente** é guardado.
  É apagado em cascata se a conta for excluída.
- **Não** coletamos IP, user agent, localização, identificador de aparelho, impressão digital do navegador, cookies de
  publicidade ou dados de terceiros; **não** há pixel/ferramenta externa de rastreamento; **não** há perfilamento nem
  compartilhamento desses dados com anunciantes de forma individual.
- Só contam usuários autenticados com acesso ativo. Visitantes sem login **não** são medidos.
- O horário e o dia são definidos no servidor (dia de relatório em `America/Sao_Paulo`).

### 1.1 Revisão após a correção de cliques e antiabuso

- **Nenhum dado novo é coletado.** Cliques sem impressão são o mesmo evento (conta + anúncio + posição + comunidade + dia +
  código aleatório do evento) no mesmo marcador de até 48 h; o agregado ganhou apenas um contador numérico
  (`unqualified_clicks`), sem identificação de pessoas.
- O teto de rajada (100 eventos/hora) é calculado a partir da validade dos próprios marcadores: sem coluna, tabela, IP ou
  histórico adicional. Chamadas rejeitadas **não gravam nada** (nem contador de rejeição).
- Continuam **fora**: IP, user agent, localização, fingerprint, cookies de publicidade, histórico individual permanente,
  visitantes anônimos e superadmin.
- Como o clique pode ocorrer sem impressão, a descrição "visualizações e cliques" do texto 2.1 permanece correta; não é
  necessário citar impressão como pré-requisito.

## 2. Textos propostos

### 2.1 Tabela "O que coletamos" (nova linha)

| Dados | Para quê |
|---|---|
| Visualizações e cliques em anúncios patrocinados (contagens por anúncio, posição e dia; registros temporários de até 48 horas ligados à sua conta) | Medir o desempenho dos patrocínios e evitar contagem duplicada ou abuso. Não usamos para criar perfil nem para personalizar anúncios |

### 2.2 Seção "Quem vê seus dados" (novo item)

- "Os parceiros patrocinadores não recebem informações sobre você. Qualquer relatório a um patrocinador traz apenas totais
  agregados (por exemplo, quantas vezes o anúncio foi visto e clicado), sem identificar usuários."

> Observação: hoje o relatório ao patrocinador **não existe** (Fase 3). Se essa frase for publicada antes dele, está
> correta e prospectiva; se o jurídico preferir, publique-a só junto com o relatório.

### 2.3 Seção "Segurança e retenção" (novo item)

- "Registros temporários de visualização e clique em anúncios, ligados à sua conta, são apagados automaticamente em até 48
  horas. Totais agregados, sem identificar você, são mantidos por até 24 meses."

### 2.4 Resumo (opcional, caixa de pontos principais)

- "Medimos visualizações e cliques em anúncios apenas em totais, sem montar perfil seu."

## 3. Pontos para decisão do jurídico

1. **Base legal.** A medição é feita por **legítimo interesse** (LGPD art. 7º, IX: contabilizar entregas de publicidade
   sem perfilamento e com dados mínimos) ou exige **consentimento**? A arquitetura foi desenhada para o primeiro caso
   (minimização, sem identificação do usuário nos agregados, retenção curta dos marcadores). Se a resposta for
   consentimento, a coleta precisa de um aceite próprio e **a flag não deve ser ligada** antes dele.
2. **Prazos.** 48 h para marcadores e 24 meses para agregados são sugestões iniciais; confirmar necessidade e
   proporcionalidade (a retenção dos agregados pode ser reduzida sem mudança de código: um parâmetro da função de limpeza).
3. **Direito de oposição.** Com legítimo interesse, o titular pode se opor. Opções: tratar via atendimento ("Privacidade
   ou exclusão da conta") ou criar uma chave "não medir minha conta" (não implementada; exigiria decisão de produto).
4. **Visitantes anônimos.** Fora de escopo e **não medidos**. Se um dia forem, é preciso decisão específica de
   identificação (sem fingerprint) e de consentimento, e atualização deste documento.
5. **Reaceite.** Decidir se a mudança é "material" a ponto de exigir novo aceite imediato ou entra na próxima versão
   programada da política.
6. **Divergência existente (não causada por esta fase), verificada em `legal/documents.json` (v1.4.0):** o item de "Segurança
   e retenção" diz "Usamos o Google Firebase para autenticação, banco de dados e armazenamento de mídias; o frontend é
   hospedado na Vercel", mas a stack oficial é **Supabase/PostgreSQL**. Corrigir na mesma revisão para a política não afirmar
   um operador que não é usado (e o operador real do tratamento de métricas é o Supabase). Isso muda a política publicada e,
   portanto, depende de aprovação e do fluxo de versionamento/reaceite existente. **Nada foi alterado em `legal/`.**
7. **Aprovação jurídica obrigatória antes de ligar a coleta:** base legal (item 1), retenção de 48 h para marcadores e de 24
   meses para agregados (item 2) e tetos de uso. Sem essa aprovação a flag de build e a chave do servidor permanecem desligadas.

## 4. Como aplicar depois da aprovação (procedimento, não executado)

O versionamento legal já existente envolve `legal/manifest.json`, `legal/documents.json`, `legal/approved-digests.json`,
o arquivo da versão anterior em `legal/test-fixtures/` e `src/utils/legal.js` (mapa `approvedArchives`), além da linha
publicada em `legal_policy` no banco (versão + digest que `has_app_access()` compara). Siga esse fluxo como foi feito na
passagem 1.3.0 → 1.4.0; não há procedimento novo nesta fase.

1. Aplicar os textos da seção 2 e subir a versão do manifesto.
2. Registrar o novo digest aprovado e arquivar a versão anterior, como no fluxo existente.
3. Publicar a nova versão em `legal_policy` (é isto que dispara o reaceite).
4. Só então ligar a coleta (ver `docs/SPONSORED_AD_METRICS.md`, "Checklist de ativação").
