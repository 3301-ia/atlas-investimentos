# VECTRA · Freqtrade

Estratégia e ferramentas da escada de travas (relatório de 20/11/2026).
Documentação completa em [`../docs/vectra-escada.md`](../docs/vectra-escada.md).

## O que roda aqui

`user_data/strategies/vectra_escada.py` opera **somente a posição principal**:
entrada por EMA 8/16 com RSI, stop de 1,0 ATR, alvo de 2R, auditoria e
disjuntores. Ela não mexe na posição.

**A escada não está aqui de propósito.** O Freqtrade não mantém posição
contrária no mesmo par ao mesmo tempo (issue
[#7386](https://github.com/freqtrade/freqtrade/issues/7386): *"No we don't -
and we're unlikely to support this in the near future"*). Reduzir a posição no
lugar da trava não é o mecanismo do relatório. A escada, com cada trava como
posição separada e contrária, roda em
[`../executor/vectra_executor.py`](../executor/README.md).

Não rode as duas no mesmo par: elas brigam pela mesma posição.

## Instalar

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install freqtrade
```

## Configurar

```bash
cp user_data/config.exemplo.json user_data/config.json
# edite chave/segredo da corretora; dry_run já vem true
```

O par padrão é `BTC/USDT:USDT` em futuros isolados, necessário para `can_short`.
Para spot, remova `trading_mode`/`margin_mode` e `can_short`.

## Backtest do Freqtrade

```bash
freqtrade download-data --config user_data/config.json --timeframes 15m \
  --timerange 20260415-20261120

freqtrade backtesting --strategy VectraEscada --config user_data/config.json \
  --timeframe 15m --timerange 20260415-20261120
```

Este backtest cobre a principal, não a escada. Para o mecanismo completo use o
executor.

## Backtest de referência

```bash
python3 ferramentas/vectra_backtest.py ../../atlas-ui/core/dados/m15_btcusdt_15m.json
```

Reproduz o relatório: 599 ciclos, US$ 684,49, 44,2% acerto, queda US$ 15,45,
travas em 75,3%, aberturas por nível 388/318/241/169/103. Com
`corrigir_sinal_encerrada=True` dá US$ 665,89, que é a conta correta (o
relatório soma 18 travas encerradas com o sinal invertido).

## Testes

```bash
python3 ferramentas/test_vectra_escada.py ../../atlas-ui/core/dados/m15_btcusdt_15m.json
```

Não precisam de Freqtrade nem de TA-Lib: os módulos do Freqtrade são
substituídos por stubs e o motor de backtest roda sobre a série.

## Arquivos de estado

| Arquivo | Conteúdo |
|---|---|
| `user_data/vectra_estado.json` | ciclos, acerto, queda, sequência de perdas, reserva, pausa |
| `user_data/logs/vectra_auditoria.jsonl` | um registro por ciclo fechado (seção 24) |

Apagar `vectra_estado.json` zera os disjuntores. É o que se faz depois de
revisar o sistema, de propósito.
