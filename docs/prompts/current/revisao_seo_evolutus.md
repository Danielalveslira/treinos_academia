# Auditoria e reconstrução de SEO — Evolutus

## Objetivo

Revisar **todo o SEO atual do Evolutus**, remover configurações ruins, duplicadas, genéricas ou inúteis e implementar uma base nova seguindo boas práticas atuais para indexação e descoberta no Google.

O projeto é um app React/Vite publicado na Vercel. A prioridade é:

- SEO técnico correto;
- páginas públicas indexáveis;
- páginas privadas fora do índice;
- metadados consistentes;
- sitemap/robots corretos;
- melhor apresentação nos resultados de busca;
- performance e acessibilidade;
- evitar keyword stuffing, hacks ou SEO artificial.

**Não fazer commit, push ou deploy sem autorização.**

---

## 1. Auditar antes de alterar

Primeiro revisar o projeto inteiro e localizar tudo relacionado a SEO:

```text
index.html
AppRoutes
rotas públicas e privadas
Vite config
Vercel config
public/
manifest
service worker/PWA
robots.txt
sitemap.xml
meta tags
canonical
Open Graph
Twitter cards
JSON-LD
titles/descriptions
headings
links internos
404
páginas legais
perfil público
landing/home pública
```

Também procurar:

```text
SEO antigo
meta tags duplicadas
keywords inúteis
descrições genéricas
canonical incorreto
robots conflitantes
sitemap desatualizado
noindex faltando
URLs antigas
domínios antigos
```

Antes de implementar, entregar:

```text
ESTADO ATUAL
- SEO encontrado;
- problemas;
- páginas indexáveis;
- páginas que não devem ser indexadas;
- riscos;
- arquivos envolvidos.

PLANO
- o que será removido;
- o que será mantido;
- o que será criado;
- arquivos a alterar.
```

Depois implementar.

---

## 2. Definir estratégia de indexação

Classificar todas as rotas.

### Devem poder ser indexadas, se públicas e úteis

Exemplos:

```text
/
páginas institucionais públicas
termos
privacidade
perfis públicos, se fizer sentido
outras páginas públicas com conteúdo real
```

### Não devem ser indexadas

Exemplos:

```text
/login
/cadastro
/esqueci-senha
/dashboard
/treino
/exercicios privados
/progresso
/historico
/admin/**
rotas internas autenticadas
telas de erro temporárias
```

Para rotas privadas, aplicar estratégia correta de:

```text
noindex, nofollow quando necessário
```

Não depender apenas de `robots.txt` para impedir indexação de conteúdo privado.

---

## 3. Titles e descriptions

Criar padrão consistente.

Exemplo:

```text
Home:
Evolutus — Acompanhe seus treinos e evolução

Description:
Registre treinos, acompanhe progresso, volume, medidas corporais e evolução em um só lugar.
```

Para páginas públicas específicas:

```text
<title único>
<meta name="description" único>
```

Evitar:

```text
títulos repetidos
"Home"
"App"
"Treinos Academia"
descrições enormes
listas de palavras-chave
```

Não usar `meta keywords`.

---

## 4. Canonical

Adicionar canonical correto nas páginas indexáveis.

Garantir:

- domínio oficial;
- HTTPS;
- sem duplicação por query params;
- sem canonical apontando para localhost;
- sem canonical errado em rotas dinâmicas.

Definir uma única origem oficial da aplicação.

---

## 5. Open Graph e compartilhamento

Implementar metadados adequados:

```text
og:title
og:description
og:type
og:url
og:image
og:site_name
```

Adicionar também:

```text
twitter:card
twitter:title
twitter:description
twitter:image
```

Criar uma imagem social adequada apenas se necessário.

Não usar imagem quebrada ou URL local.

---

## 6. Dados estruturados

Avaliar e implementar JSON-LD apenas onde fizer sentido.

Possíveis tipos:

```text
WebSite
SoftwareApplication
WebApplication
Organization
```

Não inventar:

```text
reviews
ratings
preços
downloads
estatísticas
```

Se não houver evidência real, não incluir.

Validar schema final.

---

## 7. robots.txt

Recriar se necessário.

Objetivos:

- permitir indexação do conteúdo público;
- não bloquear assets necessários para renderização;
- apontar para sitemap;
- evitar regras inúteis ou conflitantes.

Não tratar `robots.txt` como mecanismo de segurança.

---

## 8. sitemap.xml

Criar ou corrigir sitemap com **somente URLs públicas e indexáveis**.

Não incluir:

```text
login
cadastro
dashboard
admin
treinos privados
progresso privado
URLs com parâmetros
404
```

Se as rotas públicas forem poucas, sitemap estático é suficiente.

Se houver rotas públicas dinâmicas reais, avaliar geração automática.

---

## 9. SPA / React / Vite

Verificar como o Google recebe o HTML inicial.

Avaliar:

- conteúdo útil existente antes da hidratação;
- title/meta inicial;
- comportamento de rotas;
- renderização client-side;
- necessidade real de prerender.

Não migrar para SSR/Next.js apenas por SEO sem justificar.

Se a home pública atual for praticamente vazia antes do JS, propor solução simples e de baixo risco primeiro.

---

## 10. Conteúdo da Home pública

Revisar a home/landing pública.

Ela deve explicar claramente:

```text
o que é o Evolutus
para quem serve
principais benefícios
recursos principais
como funciona
```

Usar estrutura semântica:

```text
1 H1 principal
H2 para seções
parágrafos reais
links internos úteis
```

Não encher a página com palavras repetidas para Google.

Priorizar linguagem natural em PT-BR.

---

## 11. Semântica e acessibilidade

Auditar:

```text
h1/h2/h3
main
nav
header
footer
section
alt de imagens
labels
links
botões
```

Problemas de acessibilidade que também afetam compreensão/indexação devem ser corrigidos.

---

## 12. URLs

Verificar:

- URLs legíveis;
- rotas públicas estáveis;
- ausência de duplicações;
- redirects desnecessários;
- trailing slash consistente;
- 404 real e útil.

Se existirem URLs antigas em produção, avaliar redirects permanentes.

---

## 13. Performance / Core Web Vitals

Auditar impacto de:

```text
JS inicial
CSS
fontes
imagens
lazy loading
chunks grandes
service worker
cache
```

Não fazer otimizações especulativas.

Priorizar problemas que realmente afetam:

```text
LCP
CLS
INP
```

Se houver imagem hero, otimizar corretamente.

---

## 14. Imagens

Garantir:

```text
alt adequado
width/height ou aspect-ratio
lazy loading onde apropriado
formato eficiente
URLs válidas
```

Não indexar desnecessariamente imagens privadas.

---

## 15. PWA e SEO

Verificar se:

```text
manifest
service worker
cache
offline fallback
```

não prejudicam:

- indexação;
- atualização de HTML;
- metadados;
- sitemap;
- robots.

Não cachear HTML antigo de forma que impeça atualização de SEO.

---

## 16. Segurança e privacidade

SEO nunca deve expor dados privados.

Confirmar que:

```text
rotas autenticadas
dados de treino
medidas corporais
admin
dados pessoais
```

não aparecem em:

```text
sitemap
JSON-LD
meta description
Open Graph
HTML público
```

---

## 17. Google Search Console

Preparar o projeto para uso correto no Search Console.

Verificar:

```text
domínio canônico
sitemap
robots
indexability
```

Se já existir verificação do Search Console, preservar.

Não adicionar códigos de verificação falsos.

Ao final, informar quais passos manuais deverão ser feitos no Search Console após deploy.

---

## 18. Analytics

Não adicionar Google Analytics automaticamente.

Se já existir analytics, apenas verificar se não interfere com performance ou consentimento.

Se não existir, deixar fora desta tarefa.

---

## 19. Testes obrigatórios

Validar:

```bash
npm test
npm run lint
npm run build
git diff --check
```

Também verificar:

```text
HTML gerado
robots.txt
sitemap.xml
canonical
meta tags
Open Graph
JSON-LD
rotas noindex
404
```

Se possível, validar com ferramentas equivalentes a:

```text
Google Rich Results Test
Schema validator
Lighthouse SEO
```

Sem depender delas como única evidência.

---

## 20. Entrega final

Informar:

```text
SEO removido
SEO novo
Rotas indexáveis
Rotas noindex
Titles/descriptions
Canonical
robots.txt
sitemap.xml
Open Graph
JSON-LD
Melhorias na Home
Performance
Arquivos alterados
Testes executados
Pendências manuais
```

Também entregar uma lista objetiva:

```text
PASSOS APÓS DEPLOY
1. enviar sitemap ao Google Search Console;
2. solicitar indexação da home;
3. validar canonical;
4. acompanhar cobertura/indexação;
```

Finalizar com:

```text
SEO REVISADO E PRONTO PARA REVISÃO
```

ou:

```text
SEO PARCIAL — EXISTEM PENDÊNCIAS
```

---

## Restrições

Não fazer commit.
Não fazer push.
Não fazer deploy.
Não usar técnicas de spam.
Não usar keyword stuffing.
Não criar backlinks artificiais.
Não esconder texto para motores de busca.
Não indexar rotas privadas.
Não migrar framework sem necessidade comprovada.
