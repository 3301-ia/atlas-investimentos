# VECTRA · Escada de travas (implementação)

Implementação do mecanismo descrito no **relatório técnico de 20/11/2026**:
entrada por cruzamento de EMA 8 × EMA 16 com RSI, stop de 1,0 ATR, alvo de
2R e uma escada de cinco travas contrárias em terços de R.

## Onde cada coisa roda

| Peça | Arquivo | O que faz |
|---|---|---|
| Backtest de referência | `freqtrade/ferramentas/vectra_backtest.py` | reproduz o relatório, em Python puro |
| Backtest no navegador | `atlas-ui/vectra-backtest.js` | o mesmo motor, para o painel e para Node |
| Painel | `atlas-ui/vectra-escada-painel.js` | aba **Ciclos**: níveis, decomposição, disjuntores, auditoria, conferência |
| **Executor da escada** | `executor/vectra_executor.py` | opera a escada com cada trava como posição contrária separada |
| Estratégia Freqtrade | `freqtrade/user_data/strategies/vectra_escada.py` | opera **só a principal** (ver abaixo) |
| Série do estudo | `atlas-ui/core/dados/m15_btcusdt_15m.json` | 21.000 velas de 15m |

## Por que a escada não vive no Freqtrade

O Freqtrade não mantém posição contrária no mesmo par ao mesmo tempo. Um
mantenedor respondeu isso na issue
[#7386](https://github.com/freqtrade/freqtrade/issues/7386): *"No we don't -
and we're unlikely to support this in the near future"*. Dentro do Freqtrade a
trava só poderia ser redução parcial da principal, e redução não é trava: é
fechamento.

Então:

- **`executor/vectra_executor.py`** é onde a escada existe. Cada trava é uma
  posição própria, de lado oposto, com alvo e corte próprios. É o mecanismo do
  relatório.
- **`freqtrade/.../vectra_escada.py`** opera apenas a principal: entrada, stop
  de 1,0 ATR, alvo de 2R, auditoria e disjuntores. Não mexe na posição.

As duas no mesmo par brigariam pela mesma posição. Escolha uma.

## Números

```bash
python3 freqtrade/ferramentas/vectra_backtest.py atlas-ui/core/dados/m15_btcusdt_15m.json
python3 executor/vectra_executor.py replay atlas-ui/core/dados/m15_btcusdt_15m.json
node atlas-ui/core/test-vectra-escada.mjs
```

| | Relatório | Backtest | Executor (conta corrigida) |
|---|---|---|---|
| Ciclos | 599 | 599 | 599 |
| Resultado | US$ 684,52 | US$ 684,49 | **US$ 665,89** |
| Acerto | 44,2% | 44,2% | 44,4% |
| Queda máxima | 15,45 | 15,45 | 15,45 |
| Pior sequência | 11 | 11 | 11 |
| Principal | 24,7% | 24,7% | 25,4% |
| Travas | 75,3% | 75,3% | 74,6% |
| Aberturas por nível | 388/318/241/169/103 | idem | idem |
| Acerto por nível | 75/93/93/98/100% | idem | idem |

### O erro de sinal do relatório

Quando a principal fecha (alvo ou stop) com travas ainda abertas, essas travas
são encerradas no mesmo preço. O relatório soma o resultado dessas travas com
o **sinal invertido**: uma trava vendida que perde quando o preço sobe aparece
como ganho.

São **18 travas** em 599 ciclos, somando **+US$ 9,30** que deveriam ser
**−US$ 9,30**. O efeito no total é **US$ 18,60**: 684,52 em vez de 665,89.

O mecanismo é o mesmo; a diferença é a contabilidade. O executor usa a conta
correta. O backtest mantém o padrão do relatório para o protocolo de validação
(seção 27) e expõe `corrigir_sinal_encerrada=True` / `corrigirSinalEncerrada: true`
para a leitura corrigida. O painel mostra as duas.

## As três regras que fazem o número fechar

1. **Ordem da vela.** A ponte entrega `[tempo, abertura, fechamento, máxima,
   mínima, volume]`, não OHLC. Ler como OHLC inverte o gatilho dos stops. O
   backtest recusa a série em vez de devolver número falso.
2. **A trava pode fechar na mesma vela em que abriu.** Fechando só na vela
   seguinte, o resultado cai para US$ 468,48 e o acerto dos níveis para 43-58%.
3. **Trava encerrada com o ciclo não conta como abertura de nível.** É o que
   transforma 393 aberturas em 388 no primeiro nível.

## Sobre medir pelo extremo

O texto da seção 22 diz que o lucro em R deve ser medido pelo **fechamento** da
vela, "não pelo extremo". Os números publicados, porém, foram gerados com o
**extremo**: medindo pelo fechamento, o resultado cai para US$ 372,14 (−45,6%)
e as aberturas viram 303/237/150/81/40. O padrão adotado é o que reproduz o
documento, e o modo conservador existe para medir essa diferença.

## Limitações que continuam valendo

- **Sem custos.** O estudo não inclui taxa nem funding. Com até cinco travas
  por ciclo são até dez eventos de taxa por ciclo, cerca de US$ 0,24 por evento
  a 0,04% sobre US$ 592. É material para um sistema que ganha US$ 1,11 por
  ciclo.
- **Preenchimento otimista.** O stop é preenchido no preço do stop, exceto
  quando a vela abre além dele. Na realidade há deslizamento, e ele piora nos
  momentos de volatilidade, que são os que geram mais travas.
- **Um ativo, um período.** BTC em 15m entre abril e novembro de 2026. ETH e
  ZEC precisam de teste próprio.
- **Margem.** Cinco travas abertas exigem 3,0 vezes o lote em margem. Em conta
  pequena com alavancagem baixa, isso inviabiliza o BTC.
- **A estratégia Freqtrade não reproduz o relatório**, porque opera só a
  principal.

## Testes

```bash
node atlas-ui/core/test-vectra-escada.mjs           # 31 ok, sem dependência
node atlas-ui/core/test-vectra-painel.mjs           # 21 ok, precisa de jsdom
python3 freqtrade/ferramentas/test_vectra_escada.py # 42 ok, sem Freqtrade
python3 executor/test_vectra_executor.py            # 38 ok
```
