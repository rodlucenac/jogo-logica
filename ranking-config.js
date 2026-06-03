/*
   Configuracao do ranking online (opcional).

   Sem firebaseDatabaseUrl o ranking fica LOCAL neste navegador.
   Para turma/sala: preencha a URL do Firebase Realtime Database ou use
   Exportar/Importar JSON na tela de ranking.

   Exemplo:
   firebaseDatabaseUrl: "https://seu-projeto-default-rtdb.firebaseio.com"
*/
window.LOGIC_INVADERS_RANKING = {
    firebaseDatabaseUrl: "",
    firebasePath: "logic-invaders/ranking-v2"
};
