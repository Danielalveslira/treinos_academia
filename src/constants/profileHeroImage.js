// Imagem de "atleta" usada nos heróis do dashboard (estado vazio e próximo treino) —
// reflete o sexo do próprio usuário quando ele informou no cadastro (ver setBirthInfo em
// usersService.js). Sem essa informação (sexo ausente ou "não informar"), mantém a
// imagem que já era usada antes dessa distinção existir.
export function getProfileHeroImage(sexo) {
  return sexo === 'feminino'
    ? { src: '/sexo_mulher.png', alt: 'Atleta fazendo levantamento terra em uma academia' }
    : { src: '/capa.png', alt: 'Atleta fazendo barra fixa em uma academia' }
}
