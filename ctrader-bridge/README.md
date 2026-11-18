# Ponte cTrader

Leitura de velas e preços ao vivo pelo cTrader Open API, para o painel VECTRA.
Só leitura: não executa ordem.

## Variáveis de ambiente
- CTRADER_CLIENT_ID
- CTRADER_CLIENT_SECRET
- CTRADER_ACCOUNT_ID (ctidTraderAccountId)
- CTRADER_ENV (demo ou live)
- CTRADER_REDIRECT (https://atlas-vectra-ui.onrender.com/ctrader-callback)

## Rotas
- /saude
- /entrar (abre o consentimento)
- /ctrader-callback (troca o code pelo token)
- /velas?simbolo=BTCUSD&tempo=15m&qtd=300
- /spot?simbolo=BTCUSD
