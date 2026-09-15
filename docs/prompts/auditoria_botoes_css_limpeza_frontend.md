# Prompt ativo — Auditoria geral de UI, botões, CSS e limpeza do frontend

## Objetivo

Faça uma revisão ampla do frontend para validar o comportamento de todos os botões e interações, revisar o CSS, remover código morto/legado/duplicado e simplificar a implementação sem alterar o comportamento esperado do sistema.

Prioridades:
1. corrigir comportamentos inconsistentes;
2. eliminar código desnecessário;
3. reduzir duplicação;
4. simplificar componentes;
5. melhorar manutenção e performance;
6. preservar integralmente os fluxos existentes.

Não quero redesign nem reescrita geral.

## Regra principal

Primeiro audite. Depois corrija.

Não remova ou refatore código apenas porque “parece desnecessário”.

Antes de alterar, confirme uso real por:
- imports;
- rotas;
- handlers;
- hooks;
- testes;
- lazy imports;
- callbacks;
- estados;
- CSS/classes;
- comportamento responsivo.

Se houver dúvida, mantenha e registre.

## 1. Auditar todos os botões e ações

Percorra as principais páginas, componentes e fluxos do frontend.

Para cada botão/ação, verifique:
- clique executa a ação correta;
- não existe botão sem handler;
- não existem dois botões fazendo a mesma coisa sem necessidade;
- texto corresponde à ação real;
- estados `disabled` estão corretos;
- loading impede clique duplicado;
- não existem submits duplicados;
- botão dentro de formulário tem `type` correto;
- ações destrutivas possuem confirmação quando necessário;
- cancelar realmente cancela;
- voltar/navegar não perde estado indevidamente;
- retry tenta novamente a operação correta;
- reload completo só é usado quando necessário;
- teclado/Enter/Escape funcionam quando aplicável;
- mobile e desktop têm o mesmo comportamento funcional.

Procure especialmente por:

```text
button
onClick
onSubmit
type="submit"
type="button"
disabled
loading
retry
reload
navigate
Link
window.location
```

## 2. Validar fluxos principais

Faça smoke/revisão dos fluxos:
- login/logout;
- cadastro;
- verificação de e-mail;
- LegalGate;
- início/dashboard;
- exercícios;
- criar/editar treino;
- executar treino;
- concluir série;
- finalizar exercício;
- histórico;
- progresso;
- comunidades;
- criar comunidade;
- entrar/sair de comunidade;
- publicar status;
- votar;
- perfil;
- suporte;
- moderação/admin.

Não altere regra de negócio sem identificar bug real.

## 3. Auditar CSS

Revise os estilos do frontend inteiro.

Procure:
- classes não utilizadas;
- estilos antigos de componentes removidos;
- regras duplicadas;
- media queries duplicadas;
- `!important` desnecessário;
- seletores globais perigosos;
- propriedades sobrescritas logo depois;
- CSS conflitante;
- regras desktop/mobile que podem ser simplificadas;
- alturas/larguras rígidas que causam overflow;
- margens/paddings redundantes;
- estilos inline repetidos;
- CSS específico que já não corresponde ao JSX atual;
- regras que não têm efeito;
- animações/transições excessivas.

Não faça redesign.

Preserve a aparência atual, corrigindo apenas inconsistências e removendo lixo.

## 4. Código morto e legado

Procure e confirme antes de remover:
- componentes não usados;
- funções não chamadas;
- hooks sem consumidores;
- services antigos;
- utils sem referência;
- estados nunca usados;
- props obsoletas;
- imports mortos;
- constantes órfãs;
- branches impossíveis;
- código comentado antigo;
- feature flags obsoletas;
- fallback legado sem uso;
- arquivos substituídos por versões novas.

Classifique cada achado:

```text
REMOVER
MANTER
ADIAR / INCERTO
```

Só remova os casos confirmados.

## 5. Código duplicado

Procure duplicações reais em:
- handlers de botões;
- validações;
- tratamento de erros;
- loading;
- navegação;
- formatação;
- modais;
- cards;
- histórico;
- workout;
- comunidades;
- perfil;
- cache;
- CSS.

Consolide apenas quando a lógica for realmente equivalente.

Não crie abstrações genéricas demais.

## 6. React e performance

Revise:
- `useEffect` desnecessário;
- efeitos com dependências incorretas;
- loops de estado;
- renders redundantes;
- estado derivado armazenado sem necessidade;
- callbacks recriados em componentes pesados;
- Context `value` recriado sem necessidade;
- listas com keys instáveis;
- subscriptions duplicadas;
- timers/listeners sem cleanup;
- queries repetidas;
- fetches duplicados;
- componentes globais pesados;
- imports que aumentam bundle inicial.

Não aplique `memo`, `useMemo` ou `useCallback` em massa.

Só use quando houver benefício claro.

## 7. Eventos, listeners e cleanup

Procure:

```text
setTimeout
setInterval
addEventListener
removeEventListener
onSnapshot
onAuthStateChanged
observer
resize
scroll
visibilitychange
```

Confirme:
- cleanup correto;
- não registra duas vezes;
- não mantém listener após unmount;
- não dispara setState depois de desmontar;
- não mantém timer desnecessário.

## 8. Tratamento de erros

Verifique:
- `catch` vazio;
- erro engolido;
- mensagem incorreta;
- erro que deixa loading infinito;
- reload usado como solução genérica;
- retry duplicado;
- botões redundantes;
- página de erro que não permite recuperação;
- operações que falham sem feedback.

Simplifique onde possível.

## 9. Acessibilidade funcional

Cheque problemas claros:
- `div` clicável sem teclado;
- botão sem nome;
- input sem label;
- foco incorreto;
- botão sem `type`;
- controles invisíveis focáveis;
- ícone clicável sem texto acessível.

Não faça auditoria WCAG completa; corrija apenas problemas objetivos.

## 10. Segurança da limpeza

Não altere sem necessidade:
- schema Firestore;
- Rules;
- Functions;
- contratos de services;
- comportamento de autenticação;
- fluxo legal;
- dados persistidos.

Se uma limpeza exigir alteração backend, apenas registre.

## 11. Estratégia de execução

Priorize:

### P0
- botão quebrado;
- ação errada;
- submit duplicado;
- loop;
- leak;
- render quebrado;
- erro silencioso crítico.

### P1
- comportamento duplicado;
- query/fetch duplicado;
- listener sem cleanup;
- CSS conflitante;
- código morto executado;
- fluxo inconsistente.

### P2
- código morto confirmado;
- CSS morto;
- duplicação simples;
- simplificação segura.

### P3
- refatoração maior;
- arquivos grandes;
- abstrações opcionais.

Implemente P0/P1 e P2 de baixo risco.
P3 deve ser registrado, não refeito automaticamente.

## 12. Diagnóstico antes de alterar

Antes de modificar código, entregue:

```text
RESUMO

BOTÕES / AÇÕES COM PROBLEMA:
- ...

DUPLICIDADES:
- ...

CSS MORTO / CONFLITANTE:
- ...

CÓDIGO MORTO:
- ...

EFFECTS / LISTENERS:
- ...

RENDERS / PERFORMANCE:
- ...

FLUXOS COM RISCO:
- ...

PLANO DE LIMPEZA:
1. ...
2. ...
3. ...

ARQUIVOS QUE PRETENDE ALTERAR:
- ...
```

Só depois implemente.

## 13. Validação obrigatória

Depois das alterações:

```text
npm test
npm run lint
npm run build
git diff --check
```

Também faça smoke test das rotas principais e valide visualmente:
- desktop;
- tablet;
- mobile.

Cheque especialmente:
- todos os botões alterados;
- formulários;
- modais;
- navegação;
- loading;
- erros;
- cancelar;
- confirmar;
- finalizar;
- retry.

## 14. Entrega final

Informe:

```text
Botões corrigidos
Ações duplicadas removidas
Código morto removido
Código duplicado consolidado
CSS removido/simplificado
Effects/listeners corrigidos
Otimizações de render
Arquivos alterados
Testes alterados/criados
npm test
npm run lint
npm run build
git diff --check
Riscos restantes
Itens adiados
```

Inclua uma tabela:

```text
ID | Prioridade | Problema | Arquivo | Correção | Validação | Risco restante
```

Conclua com:

```text
FRONTEND LIMPO, OTIMIZADO E PRONTO PARA REVISÃO
```

ou:

```text
AINDA EXISTEM PROBLEMAS QUE EXIGEM REVISÃO
```

## Restrições

Não faça redesign.
Não reescreva o frontend.
Não faça alterações cosméticas sem benefício.
Não remova código sem confirmar que está morto.
Não faça commit.
Não faça push.
Não faça deploy.
