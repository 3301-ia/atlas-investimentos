# VECTRA · Executor da escada de travas

A escada do relatório de 20/11/2026 exige que cada trava seja uma **posição
contrária separada**: um short contra o long, um long contra o short.

O Freqtrade não faz isso. Um mantenedor respondeu de forma direta na issue
[#7386](https://github.com/freqtrade/freqtrade/issues/7386): *"No we don't -
and we're unlikely to support this in the near future"*. Dentro do Freqtrade a
trava só conseguiria ser redução parcial da principal, que é outro mecanismo.
Por isso o executor existe.

## Replay (validação)

```bash
python3 executor/vectra_executor.py replay atlas-ui/core/dados/m15_btcusdt_15m.json
```

Roda sobre a série do estudo e usa a mesma camada de corretora que a operação
real, com as travas como posições independentes. Saída esperada:

```
599 ciclos · US$ 665,89 · 44,4% acerto · queda US$ 15,45
principal US$ 169,10 (25,4%) · travas US$ 496,79 (74,6%)
níveis: 388 / 318 / 241 / 169 / 103 aberturas, acerto 75/93/93/98/100%
```

Os US$ 665,89 são o relatório (684,52) **com a conta corrigida**: o documento
somava as 18 travas encerradas junto com o ciclo com o sinal invertido, o que
inflava o resultado em US$ 18,60. O mecanismo é o mesmo; a diferença é o sinal
dessas 18 posições.

## Ao vivo

```bash
# simulado: nenhuma ordem é enviada
python3 executor/vectra_executor.py ao-vivo --corretora binanceusdm --par BTC/USDT:USDT

# real: exige chave, confirmação explícita e testnet desligada
export VECTRA_CHAVE=... VECTRA_SEGREDO=...
python3 executor/vectra_executor.py ao-vivo --real --confirmo-risco --no-testnet
```

O modo real usa `positionSide` (hedge mode da exchange) para manter long e
short ao mesmo tempo no mesmo par. A corretora precisa estar em hedge mode, e
o par precisa permitir as duas posições.

**Não testei execução real contra corretora.** Rode o replay, depois testnet,
depois lote mínimo. A camada real é fina de propósito: ordens a mercado, uma
por posição, sem promessa de preenchimento no preço do nível.

## Disjuntores

Os limites são os da seção 25 (acerto < 28% desliga, < 33% reduz lote, queda
> 30 pausa, > 46,35 desliga, 15 perdas seguidas pausa). No replay eles ficam
desligados: são regra de operação, não de validação. Ligados, o replay para
nos primeiros 20 ciclos, quando o acerto da amostra inicial ainda é baixo.

## Testes

```bash
python3 executor/test_vectra_executor.py
```

Provam o ponto central: cada trava tem id próprio, lado oposto à principal,
0,60 do lote, alvo e corte próprios, e a principal nunca é reduzida.
