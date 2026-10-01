# EVOLUÇÃO DA FEATURE — TREINO MARCADO V1

## Objetivo

Quero agora evoluir **somente a feature `Treino marcado`**.

Não mexa em Conquistas, Enquetes comuns, rankings, desafios, EvoCoins ou outras features nesta rodada.

O objetivo é transformar `Treino marcado` de um simples tipo de post em um **evento funcional da comunidade**.

---

# 1. Antes de alterar

Audite novamente o fluxo atual completo:

- `StatusForm`
- `StatusCard` / `WorkoutStatus`
- `statusesService`
- `participants`
- Firestore Rules
- `expiresAt`
- `workout.date`
- feed
- cache
- permissões
- compartilhamento

Confirme o desenho técnico e depois implemente se não houver bloqueador.

---

# 2. Corrigir o problema estrutural de expiração

Hoje:

```text
status criado
→ expiresAt = createdAt + 24h
```

inclusive para `type === 'workout'`.

Isso faz um treino marcado para daqui a vários dias desaparecer antes de acontecer.

Quero separar conceitualmente:

```text
validade no feed
```

de:

```text
validade do evento / possibilidade de participar
```

`workout.date` deve ser a autoridade para determinar se ainda é possível participar.

Um treino futuro não pode deixar de aceitar participantes só porque o post completou 24h.

Também não deve ser possível entrar em um treino cuja data já passou.

Não mantenha um post comum no feed por semanas apenas para manter o evento vivo.

Se necessário, crie uma forma própria de recuperar **próximos treinos** da comunidade.

Preserve a política de feed recente para posts normais.

---

# 3. Seção "Próximos treinos"

Avalie e implemente uma seção dedicada na comunidade para eventos futuros:

```text
Próximos treinos
```

Ela deve buscar somente:

```text
type == 'workout'
workout.date > agora
comunidade atual
```

com quantidade limitada e ordenada pelo evento mais próximo.

Não misture isso com `Destaques`.

Não duplique o mesmo evento desnecessariamente na tela.

Se ele ainda estiver no feed recente, defina uma UX coerente para não poluir a página.

Explique a decisão adotada.

---

# 4. Card do Treino Marcado

Quero uma identidade própria.

Conceitualmente:

```text
┌─────────────────────────────────────┐
│ 🏋️ TREINO MARCADO                  │
│                                     │
│ Treino de pernas                    │
│ Sábado · 17:30                      │
│ Academia X                          │
│                                     │
│ Começa em 2h                        │
│                                     │
│ 👥 8 confirmados                    │
│ Daniel, Pedro, João e +5            │
│                                     │
│ [ ✓ Vou participar ]                │
│ [ Adicionar ao calendário ]         │
└─────────────────────────────────────┘
```

Preserve o estilo visual do Evolutus; isso é referência funcional, não obrigação de copiar exatamente.

---

# 5. Estados temporais

O card deve calcular corretamente estados como:

```text
Em 3 dias
Amanhã
Hoje · 17:30
Começa em 2h
Começa em 15 min
Em andamento, se fizer sentido
Concluído
```

Faça isso client-side quando possível.

Evite scheduler/Function apenas para atualizar texto de contagem regressiva.

Depois que o evento passar:

```text
não permitir nova confirmação
botão de participar desaparece/desabilita
card mostra Concluído
```

---

# 6. Participação

Na V1 continue com uma decisão simples:

```text
Vou participar
```

e permitir cancelar a própria participação enquanto o evento ainda estiver aberto.

Não implementar ainda:

```text
Talvez
Não vou
limite de vagas
check-in
presença real
```

Isso fica para V2.

Garantir:

```text
entrar uma vez → 1 participação
clicar/repetir request → não duplica
cancelar → remove corretamente
evento passado → não aceita join
usuário não membro → não aceita
```

---

# 7. Quem poderá ver os participantes

Para `Treino marcado`, participação é uma informação social.

Quero:

```text
membros da comunidade
→ podem ver quem marcou "Vou participar"
```

Não apenas o organizador.

O criador do evento também vê normalmente a lista completa.

Não existe necessidade de mostrar:

```text
quem recusou
```

porque essa opção ainda nem existirá.

Antes de implementar, confira as Rules atuais. O relatório anterior indicou que membros já podem ler `participants`, então provavelmente será principalmente UI.

Se as Rules já permitem exatamente isso, não as altere desnecessariamente.

---

# 8. Lista de participantes

No card, mostrar uma prévia curta:

```text
Daniel, Pedro, João e +5
```

e permitir abrir:

```text
Ver participantes
```

com a lista completa.

Reaproveite o padrão de resolução de usernames já existente no projeto.

Não faça N+1 de usuários.

Não carregue a lista completa de participantes de todos os cards automaticamente se isso gerar reads desnecessárias.

Prefira:

```text
contagem no card
pequena prévia se barata
lista completa sob demanda
```

Documente o custo de reads.

---

# 9. Organizador

Mostre claramente:

```text
Organizado por @usuario
```

usando o autor já existente do status.

Não crie nova fonte de verdade para organizer se `authorId` já resolve.

---

# 10. Adicionar ao calendário

Adicione:

```text
Adicionar ao calendário
```

gerando um arquivo/evento `.ics` no frontend.

Use:

```text
título
data/hora
local, se houver
nome da comunidade
```

Não envie nada para Google Calendar diretamente.

Não precisa OAuth nem integração externa.

Deve funcionar sem nova Function/Firestore write.

---

# 11. Compartilhamento

Audite o compartilhamento atual.

Hoje, segundo o relatório, o link é genérico da comunidade.

Se a arquitetura atual permitir de forma simples, quero que um Treino Marcado possa ser compartilhado com referência ao evento específico.

Não faça uma reforma de roteamento enorme só por isso.

Se exigir mudança grande, documente e deixe para V2.

---

# 12. Apoio / Negativo

Audite se faz sentido continuar mostrando:

```text
Apoio
Negativo
```

em `Treino marcado`.

Minha preferência de produto é que o principal sinal social seja:

```text
Vou participar
```

e não uma votação econômica sobre o evento.

Porém, **não remova o EconomyVoteBar automaticamente nesta rodada** sem primeiro confirmar:

```text
comportamento frontend atual
comportamento backend
impacto econômico
reward de autor
```

Se recomendar remover, apresente a decisão antes de implementar essa parte.

Não quero repetir o problema que tivemos com enquetes, onde frontend e backend tinham regras diferentes.

---

# 13. Compatibilidade

Analise posts `workout` já existentes.

Não faça migração de produção automaticamente.

Como o sistema ainda não possui usuários reais, podemos aceitar uma estratégia simples, mas informe se algum dado de teste antigo ficará incompatível.

---

# 14. Firestore / índices / custo

Antes de criar a seção `Próximos treinos`, determine a query necessária.

Informe:

```text
campos
where
orderBy
limit
índice necessário
```

Evite:

```text
listener por card
polling
leitura de todos os statuses para filtrar no cliente
N+1 de participantes
```

Quero uma solução escalável.

---

# 15. Mobile

Treino marcado precisa funcionar muito bem no mobile.

Verifique:

```text
título longo
local longo
data/hora
nomes dos participantes
botão participar
botão calendário
modal/lista de participantes
```

Nada pode causar overflow horizontal.

---

# 16. Testes

Quero cobertura para pelo menos:

```text
treino futuro continua participável depois da janela genérica de 24h
treino passado não aceita participação
membro pode participar
cancelar participação
join duplicado não duplica participante
não membro não participa
estado Hoje
estado Começa em X
estado Concluído
lista/contagem de participantes
usuário atual aparece corretamente após participar
cancelar atualiza UI sem reload
próximos treinos ordenados por data
limite da query
calendário .ics contém data/título/local corretos
```

Se Rules mudarem, adicione testes de Rules.

---

# 17. Não implementar nesta rodada

Não implemente:

```text
RSVP Talvez
Não vou
limite de vagas
notificações
push
check-in
EvoCoins
ranking
desafio
badges
recorrência
conquista automática
pipeline enquete → treino
```

Esses recursos virão depois.

---

# 18. Entrega

Quero primeiro um diagnóstico curto do desenho final.

Se não houver bloqueador, implemente a V1 do Treino Marcado.

Ao final entregue:

```text
arquitetura anterior
arquitetura nova
arquivos alterados
Rules alteradas, se houver
índices necessários
impacto de reads/writes
compatibilidade
testes
lint
build
git diff --check
```

Não faça commit, push ou deploy ainda.

---

# Objetivo final

Ao terminar esta rodada, `Treino marcado` precisa deixar de ser:

```text
"um post com data"
```

e passar a ser:

```text
"um evento real da comunidade"
```

que pode ser criado com antecedência, permanecer acessível até acontecer, mostrar quem vai participar, atualizar a participação imediatamente e permitir que o membro coloque o evento no calendário.
