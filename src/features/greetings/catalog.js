// Catálogo EDITORIAL das mensagens do cabeçalho da Home. Texto estático, escrito e revisado à mão (nada é
// gerado em tempo de execução, nada vem do servidor). Princípio: "um parceiro de treino, não um treinador
// que dá bronca" -- incentivo e humor leve, nunca culpa, comparação corporal ou promessa de resultado.
//
// IDs: `<categoria>.<voz>.<NNN>`, derivados da POSIÇÃO na lista. Por isso as listas são APPEND-ONLY: nunca
// reordene nem remova uma frase publicada (o ID alimenta a rotação diária); para reorganizar de verdade,
// incremente CATALOG_VERSION. Variantes `masculino`/`feminino` só trocam a gramática/vocativo; humor e
// carinho são equivalentes. `neutro` não tem nenhuma marca de gênero e completa qualquer voz.
//
// `{nome}` é o primeiro nome (ou "atleta"); pode faltar na frase. No máximo um emoji por mensagem.

export const CATALOG_VERSION = 1
export const IMPACT_EYEBROW = 'SEU RITMO, SUA EVOLUÇÃO'
export const WELCOME_EYEBROW = 'BOAS-VINDAS AO EVOLUTUS'

export const VOICES = ['masculino', 'feminino', 'neutro']
export const DAILY_CATEGORIES = [
  'completed',
  'in_progress',
  'rest',
  'planned_due',
  'planned',
  'return',
  'morning',
  'afternoon',
  'night',
]
export const CATEGORIES = [...DAILY_CATEGORIES, 'welcome']

const VOICE_CODE = { masculino: 'masc', feminino: 'fem', neutro: 'neutro' }

const SOURCE = {
  morning: {
    neutro: [
      'Bom dia, {nome}! O primeiro passo já aconteceu: você apareceu.',
      'Bom dia! Que o café faça efeito e a motivação chegue logo atrás. ☕',
      'Bom dia, {nome}. Um dia novo, uma página limpa no seu histórico.',
      'Bom dia! Hoje o objetivo é simples: fazer o que for possível, do seu jeito.',
      'Bom dia, {nome}! Seu progresso acordou antes de todo mundo e já está aqui.',
      'Manhã chegando, {nome}. Que tal começar com um alongamento e boas intenções?',
      'Bom dia! A rotina agradece cada pequeno passo que você dá.',
      'Bom dia, {nome}. Até o despertador respeita quem tem constância.',
      'Bom dia! Respire fundo, ajeite a playlist e veja o que o dia reserva. 🎧',
      'Bom dia, {nome}! Evolução também se constrói em dias comuns.',
      'Bom dia! Seu histórico está arrumado e esperando as próximas páginas.',
      'Bom dia, {nome}. Cada dia em que você aparece conta a seu favor.',
    ],
    masculino: [
      'Bom dia, campeão! Até os halteres estão curiosos sobre hoje.',
      'Bom dia, parceiro! Hoje o plano é simples: aparecer e fazer o seu melhor.',
      'Bom dia, {nome}! Motivado ou não, você já está aqui, e isso vale muito.',
      'Bom dia, guerreiro! O dia está inteiro pela frente e o ritmo é você quem escolhe.',
    ],
    feminino: [
      'Bom dia, campeã! Tem mais um capítulo de evolução começando.',
      'Bom dia, parceira! Hoje o plano é simples: aparecer e fazer o seu melhor.',
      'Bom dia, {nome}! Motivada ou não, você já está aqui, e isso vale muito.',
      'Bom dia, guerreira! O dia está inteiro pela frente e o ritmo é você quem escolhe.',
    ],
  },
  afternoon: {
    neutro: [
      'Boa tarde! Do seu jeito e no seu tempo: o progresso topa.',
      'Boa tarde, {nome}! O dia anda e você escolhe o compasso.',
      'Boa tarde! O dia ainda tem muito a oferecer, e você decide o quanto.',
      'Boa tarde, {nome}. Um copo d’água, um respiro e o resto no seu ritmo. 💧',
      'Boa tarde! Tarde boa para lembrar que constância vale mais que pressa.',
      'Boa tarde, {nome}! Seu espaço no Evolutus está arrumado e esperando você.',
      'Boa tarde! Sem drama e sem pressa: um passo de cada vez já é caminho.',
      'Boa tarde, {nome}! Playlist pronta, ideia clara: o resto é com você.',
      'Boa tarde! Pausa do dia: respire fundo e lembre o quanto já avançou.',
      'Boa tarde, {nome}! Constância não precisa de barulho, só de presença.',
      'Boa tarde! Seu histórico adora tarde produtiva, mas aceita tarde tranquila também.',
      'Boa tarde, {nome}. Vale o possível de hoje, não o perfeito de ninguém.',
    ],
    masculino: [
      'Fala, {nome}! O dia segue e seu ritmo também.',
      'Boa tarde, campeão! O dia segue e quem dá o compasso é você.',
      'Boa tarde, parceiro! O halter não vai a lugar nenhum, mas adora companhia.',
      'Boa tarde, {nome}! Que você termine o dia orgulhoso do que decidiu fazer.',
    ],
    feminino: [
      'Boa tarde, {nome}! Seu ritmo é quem manda por aqui.',
      'Boa tarde, campeã! O dia segue e quem dá o compasso é você.',
      'Boa tarde, parceira! O halter não vai a lugar nenhum, mas adora companhia.',
      'Boa tarde, {nome}! Que você termine o dia orgulhosa do que decidiu fazer.',
    ],
  },
  night: {
    neutro: [
      'Boa noite! O progresso também sabe trabalhar no turno da noite.',
      'Boa noite, {nome}. Hora de olhar o dia com carinho, treinando ou não.',
      'Boa noite! O dia pode ter sido corrido, mas aqui o clima é de calma.',
      'Boa noite, {nome}! Amanhã tem página nova, e hoje já tem história.',
      'Boa noite! Que o descanso de hoje ajude o amanhã a render mais.',
      'Boa noite, {nome}. Luz baixa, histórico aberto e ninguém com pressa.',
      'Boa noite! Hora de desacelerar: respire fundo e deixe a cabeça descansar.',
      'Boa noite, {nome}! Até a lua respeita quem cuida da própria rotina. 🌙',
      'Boa noite! Confira o dia, ajuste o plano e depois vá dormir em paz.',
      'Boa noite, {nome}. Constância também se faz nas noites tranquilas.',
      'Boa noite! Quem cuida da rotina cuida do futuro, um dia de cada vez.',
      'Boa noite, {nome}! Feche o dia com calma: o Evolutus guarda tudo por aqui.',
    ],
    masculino: [
      'Boa noite, guerreiro! Seu registro de hoje merece respeito.',
      'Boa noite, campeão! Dormir bem também faz parte do treino.',
      'Boa noite, parceiro! O dia foi seu e amanhã a gente continua.',
      'Boa noite, {nome}! Vá dormir tranquilo: o que importa está salvo aqui.',
    ],
    feminino: [
      'Boa noite, guerreira! Sua dedicação não passa despercebida.',
      'Boa noite, campeã! Dormir bem também faz parte do treino.',
      'Boa noite, parceira! O dia foi seu e amanhã a gente continua.',
      'Boa noite, {nome}! Vá dormir tranquila: o que importa está salvo aqui.',
    ],
  },
  completed: {
    neutro: [
      'Treino feito. Agora é oficial: hoje teve evolução.',
      'Treino registrado, {nome}! A memória do celular agradece. 📱',
      'Missão cumprida por hoje, {nome}. O resto do dia é bônus.',
      'Mais um treino no histórico. Constância é isso.',
      '{nome}, seu treino de hoje já está no histórico. Respire e comemore.',
      'Treino concluído! Água, alongamento e orgulho, nessa ordem. 💧',
      'Hoje você apareceu e fez acontecer. O histórico confirma.',
      'Treino de hoje: concluído. Cobrança de hoje: nenhuma.',
      'Boa, {nome}! Cada treino concluído é um tijolo na sua rotina.',
      'Feito é melhor que perfeito, e você fez. Parabéns, {nome}!',
      'Treino finalizado! O você de amanhã manda um agradecimento.',
      'Registro salvo, {nome}. A evolução tinha compromisso marcado e você compareceu.',
    ],
    masculino: [
      'Boa, campeão! Mais um treino para a história.',
      'Mandou bem, {nome}! Hoje você foi o melhor parceiro do seu próprio treino.',
      'Treino concluído, guerreiro! Pode descansar com a consciência tranquila.',
      'Treino concluído, {nome}! Você saiu de hoje orgulhoso do que fez, e com razão.',
    ],
    feminino: [
      'Mandou bem, campeã! Mais uma conquista no seu histórico.',
      'Mandou bem, {nome}! Hoje você foi a melhor parceira do seu próprio treino.',
      'Treino concluído, guerreira! Pode descansar com a consciência tranquila.',
      'Treino concluído, {nome}! Você saiu de hoje orgulhosa do que fez, e com razão.',
    ],
  },
  in_progress: {
    neutro: [
      'Pausa estratégica? Seu treino continua aqui, esperando você.',
      'Seu treino está em andamento, {nome}. Retome quando estiver à vontade.',
      '{nome}, o treino de hoje ficou em pausa. Ele é paciente.',
      'Treino aberto, sem cronômetro de cobrança. Continue no seu tempo.',
      'Seu treino está no ponto onde você parou. Zero drama.',
      'Respirou? Hidratou? O treino segue aqui quando você voltar, {nome}.',
      'Treino em andamento: bom sinal. Falta só o próximo passo.',
      'Tudo salvo, {nome}. É só continuar de onde parou.',
      'Começar é a parte mais difícil, {nome}, e isso você já fez.',
      'Seu treino não saiu do lugar, só está esperando.',
      '{nome}, uma pausa também faz parte. Seu treino continua intacto.',
      'Treino aberto por aqui. Quando quiser, a próxima série está pronta.',
    ],
    masculino: [
      'Seu treino está no jogo, {nome}. Continue quando estiver pronto.',
      'Bora, campeão? O treino ficou te esperando, sem pressa.',
      'Respira, guerreiro. O treino segue exatamente de onde você parou.',
      'Pausa feita, {nome}? Volte descansado: o treino está do mesmo jeito.',
    ],
    feminino: [
      'Seu treino está no jogo, {nome}. Continue quando estiver pronta.',
      'Bora, campeã? O treino ficou te esperando, sem pressa.',
      'Respira, guerreira. O treino segue exatamente de onde você parou.',
      'Pausa feita, {nome}? Volte descansada: o treino está do mesmo jeito.',
    ],
  },
  rest: {
    neutro: [
      'Hoje até os músculos pediram um dia de folga. 😴',
      'Dia de recuperação, {nome}: o corpo trabalha enquanto você descansa.',
      'Hoje o plano é não ter plano. Descansar também conta.',
      'Folga no plano. Sofá liberado, consciência tranquila.',
      '{nome}, descanso programado: o músculo agradece e a rotina também.',
      'Dia de pausa! Alongar, se hidratar e curtir o dia já é um ótimo programa.',
      'Descansar é parte do treino, {nome}. Hoje é essa parte.',
      'Modo recarga ativado, {nome}. A energia volta renovada. 🔋',
      'Hoje é dia de recarregar a bateria humana, {nome}.',
      'A planilha tirou o dia de folga. Aproveite, {nome}!',
      'Sem treino marcado hoje, {nome}. Use o tempo para o que faz bem.',
      'Descanso também gera resultado, {nome}. Hoje é dia de deixar acontecer.',
    ],
    masculino: [
      'Descanso autorizado, campeão. Recuperar também é treinar com inteligência.',
      'Hoje é folga, parceiro. Quem descansa bem treina melhor depois.',
      'Dia de pausa, {nome}! Fique tranquilo: recuperar faz parte do plano.',
      'Descanso liberado, guerreiro. Os halteres seguram a saudade até a próxima.',
    ],
    feminino: [
      'Descanso autorizado, campeã. Recuperar também é treinar com inteligência.',
      'Hoje é folga, parceira. Quem descansa bem treina melhor depois.',
      'Dia de pausa, {nome}! Fique tranquila: recuperar faz parte do plano.',
      'Descanso liberado, guerreira. Os halteres seguram a saudade até a próxima.',
    ],
  },
  planned: {
    neutro: [
      'O plano está pronto. A trilha sonora fica por sua conta. 🎧',
      'Treino de hoje organizado, {nome}. É só escolher a hora.',
      'Seu treino de hoje está pronto, {nome}. Sem pressa e sem cobrança.',
      'Há um treino planejado para hoje. O resto do dia se organiza em volta dele.',
      'Treino marcado, {nome}. Que tal encaixar quando fizer sentido para você?',
      'Plano do dia: um treino e muito bom humor. Os dois estão disponíveis.',
      '{nome}, seu treino de hoje está no cardápio. Tudo pronto para quando quiser.',
      'Treino planejado é treino já meio pensado. Falta só a execução, {nome}.',
      'Seu plano de hoje está aí, prontinho. Escolha o momento e vá no seu ritmo.',
      'Hoje tem treino no plano, {nome}. Tênis, água e playlist, quando for a hora.',
      'Uma coisa a menos para decidir: o treino de hoje já está definido.',
      'Treino de hoje à vista! Cada série registrada deixa o histórico mais bonito.',
    ],
    masculino: [
      'Treino organizado, campeão. Uma preocupação a menos.',
      'Plano pronto, {nome}. Fique à vontade: você está no controle, parceiro.',
      'O treino de hoje está esperando, guerreiro. Escolha o momento e vá com calma.',
      'Hoje tem treino no plano, {nome}. Que você esteja animado, ou pelo menos curioso.',
    ],
    feminino: [
      'Treino organizado, campeã. Uma preocupação a menos.',
      'Plano pronto, {nome}. Fique à vontade: você está no controle, parceira.',
      'O treino de hoje está esperando, guerreira. Escolha o momento e vá com calma.',
      'Hoje tem treino no plano, {nome}. Que você esteja animada, ou pelo menos curiosa.',
    ],
  },
  planned_due: {
    neutro: [
      'Chegou seu horário favorito de cuidar do movimento.',
      'Seu treino está por aqui, {nome}. Sem correria.',
      'Estamos no seu horário preferido, {nome}. O treino está pronto para você.',
      '{nome}, bateu o seu horário preferido. Sem pressão, só um aviso amigável.',
      'Seu horário preferido chegou. O treino espera e tem paciência de sobra.',
      'Horário combinado, {nome}! Se for um bom momento, o treino está pronto.',
      'Seu treino planejado está disponível. Comece quando fizer sentido para você.',
      'O horário que você escolheu chegou. Sem cobrança: só um convite.',
      '{nome}, é o seu horário preferido. A decisão continua toda sua.',
      'Tênis por perto? O treino está pronto no seu horário preferido.',
      'Seu treino está de plantão. Quando você quiser, ele atende.',
      'Horário nobre do seu treino, {nome}! Se rolar, o plano está prontinho.',
    ],
    masculino: [
      'É o seu horário, campeão! O treino está esperando quando você quiser.',
      'Chegou o seu horário, parceiro. Aqui é convite, não cobrança.',
      'Horário combinado, guerreiro! Se estiver disposto, o treino está pronto.',
      '{nome}, seu horário chegou. Se estiver animado, o plano está prontinho.',
    ],
    feminino: [
      'É o seu horário, campeã! O treino está esperando quando você quiser.',
      'Chegou o seu horário, parceira. Aqui é convite, não cobrança.',
      'Horário combinado, guerreira! Se estiver disposta, o treino está pronto.',
      '{nome}, seu horário chegou. Se estiver animada, o plano está prontinho.',
    ],
  },
  return: {
    neutro: [
      'Olha quem apareceu! Bom ter você por aqui outra vez.',
      'Bom ter você de volta, {nome}. Seu espaço está do jeitinho que você deixou.',
      '{nome}, retome no seu ritmo. O histórico aceita qualquer recomeço.',
      'Voltar também é um começo, {nome}. E um começo e tanto.',
      'Seu lugar no Evolutus estava guardado. Pode se ajeitar, {nome}.',
      'Recomeçar não tem fila nem prazo, {nome}. Comece pelo que for confortável.',
      'Que bom que você voltou! A rotina também sabe esperar.',
      '{nome}, a porta estava aberta e a playlist continua boa. 🎧',
      'Retomada tranquila é retomada boa. Aqui não existe zerar, só continuar.',
      'Reencontro marcado com a sua evolução, {nome}. Bom te ver por aqui!',
      'Sem cobrança e sem sermão: só um oi de quem estava com saudade.',
      '{nome}, o primeiro passo de volta já foi dado: você abriu o app.',
    ],
    masculino: [
      'Bem-vindo de volta, {nome}! Seu espaço está aqui.',
      'Que bom te ver de novo, campeão! A gente retoma de onde der.',
      'Voltou, guerreiro! O histórico estava de portas abertas.',
      'Bem-vindo de volta, parceiro! Um passo já vale como retomada.',
    ],
    feminino: [
      'Bem-vinda de volta, {nome}! Seu espaço está aqui.',
      'Que bom te ver de novo, campeã! A gente retoma de onde der.',
      'Voltou, guerreira! O histórico estava de portas abertas.',
      'Bem-vinda de volta, parceira! Um passo já vale como retomada.',
    ],
  },
  welcome: {
    neutro: [
      'Chegou no Evolutus! Seu treino acaba de ganhar uma casa. 💚',
      'Boas-vindas, {nome}! Aqui cada treino conta, e o primeiro é quando você quiser.',
      '{nome}, que bom ter você aqui! Seu histórico começa em branco e vai ficar bonito.',
      'Tudo pronto por aqui, {nome}. Seu caminho de evolução começa agora.',
      'Seu espaço no Evolutus está montado. Entre, explore e fique à vontade!',
      'Oi, {nome}! O primeiro passo era se cadastrar. Já foi, e foi bem dado.',
      'Boas-vindas ao time, {nome}! O próximo capítulo da sua rotina começa aqui.',
      'Que a jornada seja leve e a constância, uma boa companhia. Boas-vindas, {nome}!',
      '{nome}, a casa é sua. Registre, acompanhe e comemore cada pequena vitória.',
      'Conta nova, histórico novo e muita evolução pela frente. Boas-vindas!',
    ],
    masculino: [
      'Bem-vindo ao time, campeão! Seu próximo capítulo começa aqui.',
      'Bem-vindo, {nome}! Os halteres já souberam da novidade e estão animados.',
      'Bem-vindo ao Evolutus, guerreiro! Aqui seu ritmo dita as regras.',
      'Bem-vindo, {nome}! Chegou o reforço que o time estava esperando.',
      'Que bom ter você aqui, parceiro! Seu primeiro registro está a um toque.',
      'Bem-vindo, {nome}! Hoje começa uma história que você escreve a cada treino.',
      'Seja bem-vindo, {nome}! Sem pressa e sem cobrança: a casa é sua.',
      'Bem-vindo, {nome}! Está tudo arrumado para você começar do seu jeito.',
      'Chegou com o pé direito, campeão! O Evolutus guarda cada passo seu.',
      'Boas-vindas, parceiro! Aqui a evolução é feita de constância, não de pressa.',
    ],
    feminino: [
      'Bem-vinda ao time, campeã! Seu próximo capítulo começa aqui.',
      'Bem-vinda, {nome}! Os halteres já souberam da novidade e estão animados.',
      'Bem-vinda ao Evolutus, guerreira! Aqui seu ritmo dita as regras.',
      'Bem-vinda, {nome}! Chegou o reforço que o time estava esperando.',
      'Que bom ter você aqui, parceira! Seu primeiro registro está a um toque.',
      'Bem-vinda, {nome}! Hoje começa uma história que você escreve a cada treino.',
      'Seja bem-vinda, {nome}! Sem pressa e sem cobrança: a casa é sua.',
      'Bem-vinda, {nome}! Está tudo arrumado para você começar do seu jeito.',
      'Chegou com o pé direito, campeã! O Evolutus guarda cada passo seu.',
      'Boas-vindas, parceira! Aqui a evolução é feita de constância, não de pressa.',
    ],
  },
}

function buildMessages() {
  const messages = []
  for (const category of CATEGORIES) {
    for (const voice of VOICES) {
      SOURCE[category][voice].forEach((text, index) => {
        messages.push(
          Object.freeze({
            id: `${category}.${VOICE_CODE[voice]}.${String(index + 1).padStart(3, '0')}`,
            category,
            voice,
            eyebrow: category === 'welcome' ? WELCOME_EYEBROW : IMPACT_EYEBROW,
            text,
            maxNameLength: 20,
            enabled: true,
          })
        )
      })
    }
  }
  return Object.freeze(messages)
}

export const MESSAGES = buildMessages()

// Pool EFETIVA de uma voz: as frases próprias dela + as neutras da mesma categoria (sem duplicar IDs), já
// ordenadas por ID para que a rotação não dependa da ordem do arquivo.
const poolCache = new Map()
export function getPool(category, voice) {
  const key = `${category}|${voice}`
  let pool = poolCache.get(key)
  if (!pool) {
    pool = MESSAGES.filter(
      (message) =>
        message.enabled &&
        message.category === category &&
        (message.voice === voice || message.voice === 'neutro')
    ).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    poolCache.set(key, pool)
  }
  return pool
}
