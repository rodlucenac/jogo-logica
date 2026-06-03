# Logic Invaders — Cyberpunk Edition

Jogo educativo de lógica proposicional no estilo *Space Invaders*, em HTML5/JavaScript puro.

## Como rodar

```bash
python3 -m http.server 8080
```

Acesse `http://localhost:8080/index.html`.

## Ranking geral

O placar é **global por pontuação**: quem fez mais pontos aparece, **mesmo tendo parado no nível 1**.

| Regra | Detalhe |
|-------|---------|
| Quando registra | Ao **terminar a partida** (game over, parar no checkpoint do nível 3 ou vencer a campanha) |
| Mínimo | Pelo menos **1 ponto** |
| Armazenamento | As **40 melhores** runs; a tela mostra o **top 8** |
| Ordenação padrão | Maior pontuação; empate: nível mais alto, depois menor tempo |
| Modo assistido | Ranking de **prática** (toggle na tela de ranking) |
| Mesmo piloto | Pode aparecer **várias vezes** com pontuações diferentes |

### Local, turma e online

- **Padrão:** `localStorage` neste navegador (`logicInvadersRankingV2`)
- **Turma:** Exportar / Importar JSON na tela de ranking
- **Global:** Firebase em `ranking-config.js` (veja comentários no arquivo)

## Testes

```bash
node tests/logic.test.js
```
