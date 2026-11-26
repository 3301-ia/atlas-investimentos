# VECTRA · escada de travas no Freqtrade

Estratégia e ferramentas da escada de travas (relatório de 20/11/2026).
A documentação completa, com as correções e os limites, está em
[`../docs/vectra-escada.md`](../docs/vectra-escada.md).

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

O par padrão é `BTC/USDT:USDT` em futuros isolados, que é o que permite
`can_short`. Para spot, remova `trading_mode`/`margin_mode` e `can_short`.

## Rodar o backtest do Freqtrade

```bash
freqtrade download-data --config user_data/config.json --timeframes 15m \
  --timerange 20260415-20261120

freqtrade backtesting --strategy VectraEscada --config user_data/config.json \
  --timeframe 15m --timerange 20260415-20261120
```

Atenção: o backtest do Freqtrade **não reproduz** os US$ 684,52 do relatório,
porque ele não mantém posição contrária no mesmo par. Para o número do
relatório, use `ferramentas/vectra_backtest.py` sobre a série do estudo.

## Rodar o backtest de referência

```bash
python3 ferramentas/vectra_backtest.py ../../atlas-ui/core/dados/m15_btcusdt_15m.json
```

## Testes

```bash
python3 ferramentas/test_vectra_escada.py ../../atlas-ui/core/dados/m15_btcusdt_15m.json
```

Os testes não precisam de Freqtrade nem de TA-Lib: os módulos do Freqtrade são
substituídos por stubs e o motor de backtest roda de verdade sobre a série.

## Arquivos de estado

| Arquivo | Conteúdo |
|---|---|
| `user_data/vectra_estado.json` | ciclos, acerto, queda, sequência de perdas, reserva, pausa |
| `user_data/logs/vectra_auditoria.jsonl` | um registro por ciclo fechado (seção 24) |

Apagar `vectra_estado.json` zera os disjuntores. É o que se faz depois de
revisar o sistema, de propósito.
