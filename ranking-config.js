/*
   Configuracao do ranking online.

   Para GitHub Pages, o jogo e estatico: ele nao consegue salvar um ranking
   global sozinho. Para compartilhar pontuacoes entre todos os visitantes,
   preencha firebaseDatabaseUrl com a URL de um Firebase Realtime Database.

   Exemplo:
   firebaseDatabaseUrl: "https://seu-projeto-default-rtdb.firebaseio.com"
*/
window.LOGIC_INVADERS_RANKING = {
    firebaseDatabaseUrl: "",
    firebasePath: "logic-invaders/ranking"
};
