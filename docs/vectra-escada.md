# VECTRA · Escada de travas (implementação)

Implementação do mecanismo descrito no **relatório técnico de 20/11/2026**:
entrada por cruzamento de EMA 8 × EMA 16 com RSI, stop de 1,0 ATR, alvo de
2R e uma escada de cinco travas contrárias em terços de R.

## Arquivos

| Arquivo | O que é |
|---|---|
| `atlas-ui/vectra-backtest.js` | Backtest reprodutível do Anexo B. Roda no navegador e em Node. |
| `atlas-ui/vectra-escada-painel.js` | Painel da escada (aba **Ciclos**): níveis, decomposição, disjuntores, auditoria, curva de equity e conferência do relatório. |
| `atlas-ui/core/dados/m15_btcusdt_15m.json` | As 21.000 velas de 15m do estudo, no formato da ponte. |
| `atlas-ui/core/test-vectra-escada.mjs` | Teste de reprodução: 684,52 ± 2% e a tabela por nível. |
| `atlas-ui/core/test-vectra-painel.mjs` | Teste do painel (precisa de jsdom). |
| `freqtrade/user_data/strategies/vectra_escada.py` | Estratégia para operar no Freqtrade. |
| `freqtrade/ferramentas/vectra_backtest.py` | O mesmo backtest em Python puro, para conferência local. |
| `freqtrade/ferramentas/test_vectra_escada.py` | Testes da estratégia, sem Freqtrade instalado. |

## Reproduzir o relatório

```bash
node atlas-ui/core/test-vectra-escada.mjs
python3 freqtrade/ferramentas/vectra_backtest.py atlas-ui/core/dados/m15_btcusdt_15m.json
```

Saída esperada (21.000 velas, lote 0,01):

```
599 ciclos · US$ 684,49 · 44,2% acerto · queda US$ 15,45
principal US$ 169,10 (24,7%) · travas US$ 515,40 (75,3%)
níveis: 388 / 318 / 241 / 169 / 103 aberturas
```

A diferença de três centavos para os US$ 684,52 do relatório é arredondamento
do documento. Todos os outros números conferem exatamente.

## A regra que faz o número fechar

Três detalhes do relatório não são óbvios e mudam o resultado:

1. **Ordem da vela.** A ponte entrega `[tempo, abertura, fechamento, máxima,
   mínima, volume]`, não OHLC. Ler como OHLC troca máxima por fechamento e
   inverte o gatilho dos stops. O backtest recusa a série quando ela está em
   OHLC, em vez de devolver um número falso.
2. **A trava pode fechar na mesma vela em que abriu.** É isso que produz
   US$ 684,52. Fechando a trava só a partir da vela seguinte (modo
   `travaSoNaVelaSeguinte`) o resultado cai para US$ 468,48 e o acerto dos
   níveis para 43% a 58% — ou seja, o estudo depende dessa regra.
3. **Trava encerrada junto com o ciclo não conta como abertura.** É o que
   transforma 393 aberturas em 388 no primeiro nível e faz a tabela por nível
   do relatório fechar exatamente.

## Painel

O painel entra dentro do cartão da aba **Ciclos**, logo abaixo do robô de
papel. Ele lê os ciclos de `RoboCiclos.estado.teste` (ou de
`RoboVivo.estado.ctx`, na aba Ao vivo) e mostra:

- resumo com acerto, resultado, queda, lucro/queda e reserva de 10%;
- decomposição principal × travas;
- tabela por nível com aberturas, acerto, % dos ciclos e resultado;
- curva de equity com área de drawdown;
- disjuntores da seção 25;
- conferência do relatório, rodando o backtest completo sobre a série
  carregada (botão **recalcular**);
- registro de auditoria com exportação em CSV.

## Estratégia Freqtrade

```bash
pip install freqtrade
cp freqtrade/user_data/config.exemplo.json freqtrade/user_data/config.json
freqtrade trade --strategy VectraEscada --config freqtrade/user_data/config.json
```

O que estava quebrado na versão anterior e foi corrigido:

| Problema | Efeito | Correção |
|---|---|---|
| `position_adjustment_enable` ausente | `adjust_trade_position` nunca era chamado: **nenhuma trava abria** | ligado, com `max_entry_position_adjustment = 5` |
| `minimal_roi` ausente | o Freqtrade recusa carregar a estratégia | `{"0": 10.0}` (ROI desligado, saída é a escada) |
| `custom_stoploss` devolvia fração da entrada | o stop andava junto com o preço a cada vela | stop é preço fixo; a distância é recalculada contra o preço atual |
| só o alvo era registrado | acerto e sequência de perdas nunca viam as perdas: **disjuntores cegos** | `confirm_trade_exit` registra toda saída |
| disjuntores fora da seção 25 | acerto < 33% desligava em vez de reduzir lote; faltava o limite de 28% | limites corrigidos, com redução de lote em `custom_stake_amount` |
| estatísticas só em memória | reiniciar o robô zerava os disjuntores | persistidas em `user_data/vectra_estado.json` |
| `talib` obrigatório | instalação frágil | EMA, RSI e ATR em pandas, iguais ao backtest |

### Limite conhecido

O Freqtrade **não mantém posição contrária no mesmo par ao mesmo tempo**. Na
estratégia, a trava é virtual: ela abre no nível e, quando toca o alvo ou o
corte, a posição principal é reduzida no tamanho da trava (stake negativo).
O efeito econômico é parecido, mas não idêntico ao relatório, onde cada trava
é uma ordem separada e a soma das travas pode chegar a 3× o lote.

Para o número do relatório, a referência é `vectra_backtest.py`. A estratégia
Freqtrade é para operar, não para reproduzir o estudo.

## Custos

O estudo não inclui taxa nem funding. Com até cinco travas por ciclo são até
dez eventos de taxa por ciclo. A 0,04% por operação sobre US$ 592, isso dá
cerca de US$ 0,24 por evento — material para um sistema que ganha US$ 1,14 por
ciclo. Antes de dinheiro real, vale refazer o backtest com a taxa da corretora.
