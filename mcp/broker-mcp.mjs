#!/usr/bin/env node
// VECTRA · servidor MCP de corretoras (stdio, JSON-RPC 2.0, sem dependência)
// Fala o protocolo MCP: initialize, tools/list, tools/call.
// Modo PADRÃO = papel. Ordem de verdade só com VECTRA_LIVE=1 e corretora liberada.
//
// Ferramentas:
//   brokers_list   · quem está plugado, em que modo e com que limite
//   quote          · último preço do ativo
//   candles        · velas normalizadas (mesmo formato do painel)
//   signal         · leitura do motor: EMAs, RSI, rompimento, veredito
//   order_place    · manda ordem (papel por padrão)
//   positions      · posições abertas e resultado
//   order_cancel   · cancela ordem
//   kill_switch    · trava geral, cancela tudo e bloqueia novas ordens

import { createInterface } from 'node:readline';

const LIVE = process.env.VECTRA_LIVE === '1';
const TETO_RISCO_USD = Number(process.env.VECTRA_MAX_RISK_USD || 5);
const TETO_ORDENS_DIA = Number(process.env.VECTRA_MAX_ORDERS_DAY || 10);

const estado = {
  travado: false,
  ordensHoje: 0,
  dia: new Date().toISOString().slice(0, 10),
  posicoes: [],
  ordens: [],
  sequencia: 0,
};

const CORRETORAS = {
  paper: { nome: 'Papel', modo: 'paper', ativo: true, fonte: 'Coinbase (preço real, execução simulada)' },
  deriv: { nome: 'Deriv', modo: 'paper', ativo: true, fonte: 'WebSocket api.deriv.com (app_id próprio)' },
  ctrader: { nome: 'cTrader Open API', modo: 'bloqueado', ativo: false, fonte: 'app em análise no portal Spotware' },
  oanda: { nome: 'OANDA', modo: 'pronto', ativo: false, fonte: 'REST v20, falta token' },
  binance: { nome: 'Binance', modo: 'pronto', ativo: false, fonte: 'REST/WS, falta chave e IP liberado' },
  bybit: { nome: 'Bybit', modo: 'pronto', ativo: false, fonte: 'REST v5, falta chave' },
  okx: { nome: 'OKX', modo: 'pronto', ativo: false, fonte: 'REST v5, falta chave' },
  mt5: { nome: 'MetaTrader 5', modo: 'ponte', ativo: false, fonte: 'precisa de ponte Windows' },
};

const SIMBOLO_COINBASE = {
  BTCUSDT: 'BTC-USD', ETHUSDT: 'ETH-USD', ZECUSDT: 'ZEC-USD',
  SOLUSDT: 'SOL-USD', XRPUSDT: 'XRP-USD',
};

async function pegar(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'VECTRA-MCP/1.0' } });
  if (!r.ok) throw new Error(`HTTP ${r.status} em ${url}`);
  return r.json();
}

async function velas(symbol, tf = '15m', limit = 200) {
  const gran = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '6h': 21600, '1d': 86400 }[tf] || 900;
  const prod = SIMBOLO_COINBASE[String(symbol).toUpperCase()];
  if (!prod) throw new Error(`sem fonte para ${symbol}`);
  const fim = Math.floor(Date.now() / 1000);
  const ini = fim - gran * Math.min(limit, 300);
  const cru = await pegar(`https://api.exchange.coinbase.com/products/${prod}/candles?granularity=${gran}&start=${ini}&end=${fim}`);
  return cru.map(([t, l, h, o, c, v]) => ({ t: t * 1000, o, h, l, c, v })).sort((a, b) => a.t - b.t).slice(-limit);
}

function ema(serie, n) {
  const k = 2 / (n + 1);
  let e = serie[0];
  return serie.map((x, i) => (i === 0 ? (e = x) : (e = x * k + e * (1 - k))));
}

function rsi(serie, n = 14) {
  let g = 0, p = 0;
  const out = new Array(serie.length).fill(null);
  for (let i = 1; i < serie.length; i++) {
    const d = serie[i] - serie[i - 1];
    const up = Math.max(d, 0), dn = Math.max(-d, 0);
    if (i <= n) { g += up / n; p += dn / n; }
    else { g = (g * (n - 1) + up) / n; p = (p * (n - 1) + dn) / n; }
    if (i >= n && p > 0) out[i] = 100 - 100 / (1 + g / p);
  }
  return out;
}

function leitura(v) {
  const c = v.map(x => x.c);
  const e8 = ema(c, 8), e16 = ema(c, 16), e50 = ema(c, 50), r = rsi(c, 14);
  const i = c.length - 1;
  const hi20 = Math.max(...v.slice(-21, -1).map(x => x.h));
  const lo20 = Math.min(...v.slice(-21, -1).map(x => x.l));
  const preco = c[i];
  const votos = [];
  votos.push({ nome: 'EMA 8 x 16', valor: e8[i] > e16[i] ? 'alta' : 'baixa', detalhe: `${e8[i].toFixed(1)} / ${e16[i].toFixed(1)}` });
  votos.push({ nome: 'EMA 50', valor: preco > e50[i] ? 'alta' : 'baixa', detalhe: `${e50[i].toFixed(1)}` });
  votos.push({ nome: 'Rompimento 20', valor: preco > hi20 ? 'alta' : preco < lo20 ? 'baixa' : 'neutro', detalhe: `${lo20.toFixed(1)} – ${hi20.toFixed(1)}` });
  votos.push({ nome: 'RSI 14', valor: r[i] > 55 ? 'alta' : r[i] < 45 ? 'baixa' : 'neutro', detalhe: r[i] ? r[i].toFixed(1) : '-' });
  const alta = votos.filter(x => x.valor === 'alta').length;
  const baixa = votos.filter(x => x.valor === 'baixa').length;
  const veredito = alta >= 3 ? 'COMPRA' : baixa >= 3 ? 'VENDA' : 'SEM SINAL';
  return { symbol: null, tf: null, preco, votos, veredito, concordancia: `${Math.max(alta, baixa)}/4`, confirmacao: hi20, cancelamento: lo20 };
}

// ── execução ──────────────────────────────────────────────────────────────
function novaOrdem({ broker, symbol, side, qty, price, sl, tp }) {
  const hoje = new Date().toISOString().slice(0, 10);
  if (hoje !== estado.dia) { estado.dia = hoje; estado.ordensHoje = 0; }
  if (estado.travado) throw new Error('kill switch acionado: nenhuma ordem passa');
  if (estado.ordensHoje >= TETO_ORDENS_DIA) throw new Error(`teto de ${TETO_ORDENS_DIA} ordens por dia atingido`);
  const risco = sl ? Math.abs(price - sl) * qty : 0;
  if (risco > TETO_RISCO_USD) throw new Error(`risco de US$ ${risco.toFixed(2)} acima do teto de US$ ${TETO_RISCO_USD}`);
  const c = CORRETORAS[broker];
  if (!c) throw new Error(`corretora desconhecida: ${broker}`);
  const real = LIVE && c.modo === 'live';
  const ordem = {
    id: `o${++estado.sequencia}`, broker, symbol, side, qty, price, sl: sl || null, tp: tp || null,
    modo: real ? 'LIVE' : 'PAPEL', criada: new Date().toISOString(), estado: 'aberta', risco_usd: Number(risco.toFixed(2)),
  };
  estado.ordensHoje++;
  estado.ordens.push(ordem);
  estado.posicoes.push({ ...ordem, preco_entrada: price });
  return ordem;
}

function fecharPosicao(id, precoSaida) {
  const p = estado.posicoes.find(x => x.id === id);
  if (!p) throw new Error(`posição ${id} não existe`);
  p.preco_saida = precoSaida;
  p.resultado_usd = Number(((precoSaida - p.preco_entrada) * p.qty * (p.side === 'buy' ? 1 : -1)).toFixed(2));
  p.estado = 'fechada';
  estado.posicoes = estado.posicoes.filter(x => x.id !== id);
  return p;
}

// ── catálogo MCP ──────────────────────────────────────────────────────────
const FERRAMENTAS = [
  { name: 'brokers_list', description: 'Lista corretoras plugadas, modo de execução e limites.', inputSchema: { type: 'object', properties: {} } },
  { name: 'quote', description: 'Último preço do ativo.', inputSchema: { type: 'object', properties: { symbol: { type: 'string' } }, required: ['symbol'] } },
  { name: 'candles', description: 'Velas normalizadas no formato do painel.', inputSchema: { type: 'object', properties: { symbol: { type: 'string' }, tf: { type: 'string' }, limit: { type: 'number' } }, required: ['symbol'] } },
  { name: 'signal', description: 'Leitura do motor: EMAs, RSI, rompimento e veredito por concordância.', inputSchema: { type: 'object', properties: { symbol: { type: 'string' }, tf: { type: 'string' } }, required: ['symbol'] } },
  { name: 'order_place', description: 'Envia ordem (papel por padrão). Respeita teto de risco e de ordens por dia.', inputSchema: { type: 'object', properties: { broker: { type: 'string' }, symbol: { type: 'string' }, side: { type: 'string' }, qty: { type: 'number' }, price: { type: 'number' }, sl: { type: 'number' }, tp: { type: 'number' } }, required: ['broker', 'symbol', 'side', 'qty', 'price'] } },
  { name: 'positions', description: 'Posições abertas e resultado acumulado.', inputSchema: { type: 'object', properties: {} } },
  { name: 'order_cancel', description: 'Cancela ordem por id.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'kill_switch', description: 'Trava geral: cancela tudo e bloqueia novas ordens.', inputSchema: { type: 'object', properties: {} } },
];

async function chamar(nome, a) {
  switch (nome) {
    case 'brokers_list':
      return { live: LIVE, teto_risco_usd: TETO_RISCO_USD, teto_ordens_dia: TETO_ORDENS_DIA, ordens_hoje: estado.ordensHoje, travado: estado.travado, corretoras: CORRETORAS };
    case 'quote': {
      const v = await velas(a.symbol, '1m', 2);
      return { symbol: a.symbol, preco: v[v.length - 1].c, em: new Date(v[v.length - 1].t).toISOString() };
    }
    case 'candles':
      return { symbol: a.symbol, tf: a.tf || '15m', velas: await velas(a.symbol, a.tf || '15m', a.limit || 200) };
    case 'signal': {
      const v = await velas(a.symbol, a.tf || '15m', 220);
      const l = leitura(v);
      return { ...l, symbol: a.symbol, tf: a.tf || '15m' };
    }
    case 'order_place':
      return novaOrdem(a);
    case 'positions':
      return { abertas: estado.posicoes, historico: estado.ordens.slice(-20) };
    case 'order_cancel':
      return fecharPosicao(a.id, a.price || 0);
    case 'kill_switch':
      estado.travado = true;
      estado.posicoes = [];
      return { travado: true, em: new Date().toISOString() };
    default:
      throw new Error(`ferramenta desconhecida: ${nome}`);
  }
}

// ── laço JSON-RPC ─────────────────────────────────────────────────────────
const rl = createInterface({ input: process.stdin });
const responder = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
const erro = (id, message) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32000, message } }) + '\n');

rl.on('line', async (linha) => {
  let msg;
  try { msg = JSON.parse(linha); } catch { return; }
  const { id, method, params } = msg;
  try {
    if (method === 'initialize') {
      return responder(id, {
        protocolVersion: '2024-11-05',
        serverInfo: { name: 'vectra-broker-mcp', version: '1.0.0' },
        capabilities: { tools: {} },
      });
    }
    if (method === 'tools/list') return responder(id, { tools: FERRAMENTAS });
    if (method === 'tools/call') {
      const r = await chamar(params?.name, params?.arguments || {});
      return responder(id, { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] });
    }
    if (method === 'notifications/initialized') return;
    return erro(id, `método não suportado: ${method}`);
  } catch (e) {
    return erro(id, e.message);
  }
});

process.stderr.write(`vectra-broker-mcp pronto · modo ${LIVE ? 'LIVE' : 'PAPEL'} · teto US$ ${TETO_RISCO_USD}\n`);
