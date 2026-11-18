# VECTRA · Fluxo de Operação (o carrossel)

O carrossel aqui não é postagem: é o trilho por onde a informação passa, da fonte até a ordem.
Oito estações, uma responsabilidade cada, e uma trava por estação. Se uma estação para, o resto não anda.

Página visual: `/vectra-fluxo.html`
Servidor MCP: `mcp/broker-mcp.mjs` (stdio, JSON-RPC 2.0, sem dependência)

## As estações

| # | Estação | Recebe | Entrega | Ferramenta MCP | Trava |
|---|---------|--------|---------|----------------|-------|
| 01 | Ingestão | — | velas cruas + último preço | `quote`, `candles` | corretora sem feed ativo não entrega |
| 02 | Normalização | velas cruas | velas limpas, ordenadas | `candles` | série com furo é descartada |
| 03 | Motor | velas limpas | voto por indicador + motivo | `signal` | sem leitura, devolve a última boa |
| 04 | Consenso | votos de 6 tempos | veredito + concordância | `signal` por tempo | anti-oscilação por fechamento de vela |
| 05 | Risco | veredito + saldo | qty, stop, risco em USD | `order_place` (validação) | teto de risco e de ordens/dia |
| 06 | Roteador | ordem + corretoras vivas | corretora escolhida + motivo | `brokers_list` | precisa 2+ corretoras ativas |
| 07 | Execução | ordem roteada | ordem aberta com id | `order_place`, `order_cancel`, `kill_switch` | dinheiro real só com `VECTRA_LIVE=1` |
| 08 | Conciliação | execuções e taxas | resultado em USD e em R | `positions` | divergência congela e avisa |

## Contratos das ferramentas

- `brokers_list` → corretoras, modo (`paper`/`live`), limites, travado
- `quote {symbol}` → `{preco, em}`
- `candles {symbol, tf, limit}` → velas `{t,o,h,l,c,v}`
- `signal {symbol, tf}` → `{preco, votos[], veredito, concordancia, confirmacao, cancelamento}`
- `order_place {broker, symbol, side, qty, price, sl?, tp?}` → ordem com `modo` (`PAPEL`/`LIVE`) e `risco_usd`
- `positions` → abertas + últimas 20 ordens
- `order_cancel {id}` → posição fechada com resultado
- `kill_switch` → trava geral, cancela tudo

## Travas de segurança (no código, não na conversa)

- Padrão é papel. `VECTRA_LIVE=1` é a única chave que liga dinheiro real.
- `VECTRA_MAX_RISK_USD` (padrão 5) recusa ordem cujo risco passe do teto.
- `VECTRA_MAX_ORDERS_DAY` (padrão 10) recusa a ordem seguinte ao limite.
- `kill_switch` bloqueia tudo até reinício consciente.

## Corretoras

| Corretora | Estado | O que falta |
|-----------|--------|-------------|
| Papel | ativa | nada, é o padrão |
| Deriv | ativa (WS no navegador) | app_id próprio para sair do público |
| cTrader Open API | bloqueada | app em análise no portal Spotware |
| OANDA | pronta | token REST v20 |
| Binance | pronta | chave + IP liberado |
| Bybit | pronta | chave |
| OKX | pronta | chave |
| MetaTrader 5 | ponte | processo Windows ou gateway |

## Onde roda

- Painel e leitura: navegador (Render é estático).
- Servidor MCP: precisa de processo com saída TCP/REST. Render exige cartão para serviço Node; alternativas: PC, Fly.io, Cloudflare Workers (só REST, não serve cTrader).

## Como ligar o MCP

```bash
VECTRA_LIVE=0 VECTRA_MAX_RISK_USD=5 VECTRA_MAX_ORDERS_DAY=10 node mcp/broker-mcp.mjs
```

Registro no cliente MCP (exemplo):

```json
{"mcpServers":{"vectra-broker":{"command":"node","args":["/caminho/mcp/broker-mcp.mjs"],
 "env":{"VECTRA_LIVE":"0","VECTRA_MAX_RISK_USD":"5"}}}}
```
