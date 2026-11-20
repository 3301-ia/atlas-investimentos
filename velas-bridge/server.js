/**
 * VECTRA · ponte de velas
 *
 * O navegador não fala mais com a corretora. Ele pede a série pronta aqui, e
 * esta ponte busca no servidor, junta os lotes, tira repetição, ordena e
 * guarda em cache. Assim a vela que chega é sempre a mesma, sem corrida entre
 * abas e sem estourar o limite da corretora do IP do visitante.
 *
 * Rodar: node velas-bridge/server.js   (porta 8787 por padrão)
 *   GET /velas?sym=BTCUSDT&tf=15m&alvo=4000&antes=<segundos opcional>
 *   GET /preco?sym=BTCUSDT
 *   GET /saude
 *
 * Sem dependência nenhuma. Node 18+.
 */

import http from 'node:http';

const PORTA = Number(process.env.PORT || process.env.VELAS_PORTA || 8787);
const TETO = 20000;
const LOTE = 1000;
const MAX_PEDIDOS = 24;
const CACHE_MS = Number(process.env.VELAS_CACHE_MS || 30000);
const TIMEOUT_MS = 12000;

const cache = new Map();

const SEG = { '1m': 60, '3m': 180, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '2h': 7200, '4h': 14400, '6h': 21600, '8h': 28800, '12h': 43200, '1d': 86400, '3d': 259200, '1w': 604800, '1M': 2592000, '3M': 7776000 };
const TF_KC = { '1m': '1min', '3m': '3min', '5m': '5min', '15m': '15min', '30m': '30min', '1h': '1hour', '2h': '2hour', '4h': '4hour', '8h': '8hour', '12h': '12hour', '1d': '1day', '1w': '1week' };
const TF_OKX = { '1m': '1m', '5m': '5m', '15m': '15m', '30m': '30m', '1h': '1H', '2h': '2H', '4h': '4H', '6h': '6H', '12h': '12H', '1d': '1D', '3d': '3D', '1w': '1W', '1M': '1M', '3M': '3M' };
const TF_BY = { '1m': '1', '3m': '3', '5m': '5', '15m': '15', '30m': '30', '1h': '60', '2h': '120', '4h': '240', '6h': '360', '12h': '720', '1d': 'D', '1w': 'W' };
const TF_CB = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '6h': 21600, '1d': 86400 };

function normalizaSimbolo(s) {
  let x = String(s || 'BTCUSDT').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (x.includes('USDT')) return x.slice(0, x.indexOf('USDT')) + 'USDT';
  if (x.endsWith('USD')) return x.slice(0, -3) + 'USDT';
  return x + 'USDT';
}

async function buscar(url, nome, diag) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { accept: 'application/json', 'user-agent': 'VECTRA/1.0' } });
    if (!r.ok) { diag.push(nome + ':' + r.status); return null; }
    const d = await r.json();
    return d;
  } catch (e) {
    diag.push(nome + ':erro');
    return null;
  } finally {
    clearTimeout(t);
  }
}

// todas as fontes devolvem [t, o, h, l, c, v] em segundos, ordem crescente

async function kucoin(sym, tf, fimSeg, diag) {
  const tipo = TF_KC[tf];
  if (!tipo) return null;
  const par = sym.replace('USDT', '-USDT');
  const passo = SEG[tf] || 900;
  const fim = fimSeg || Math.floor(Date.now() / 1000);
  const ini = fim - 1400 * passo;
  const d = await buscar(`https://api.kucoin.com/api/v1/market/candles?type=${tipo}&symbol=${par}&startAt=${ini}&endAt=${fim}`, 'kucoin', diag);
  const lista = d && d.data;
  if (!Array.isArray(lista) || !lista.length) return null;
  return lista.map((k) => [Number(k[0]), Number(k[1]), Number(k[2]), Number(k[3]), Number(k[4]), Number(k[5])])
    .sort((a, b) => a[0] - b[0]);
}

async function okx(sym, tf, fimSeg, diag) {
  const bar = TF_OKX[tf];
  if (!bar) return null;
  const base = sym.replace('USDT', '');
  const q = fimSeg ? `&after=${fimSeg * 1000}` : '';
  const d = await buscar(`https://www.okx.com/api/v5/market/history-candles?instId=${base}-USDT&bar=${bar}&limit=300${q}`, 'okx', diag);
  const lista = d && d.data;
  if (!Array.isArray(lista) || !lista.length) return null;
  return lista.map((k) => [Math.floor(Number(k[0]) / 1000), Number(k[1]), Number(k[2]), Number(k[3]), Number(k[4]), Number(k[5])])
    .sort((a, b) => a[0] - b[0]);
}

async function bybit(sym, tf, fimSeg, diag) {
  const i = TF_BY[tf];
  if (!i) return null;
  const q = fimSeg ? `&end=${fimSeg * 1000}` : '';
  const d = await buscar(`https://api.bybit.com/v5/market/kline?category=spot&symbol=${sym}&interval=${i}&limit=1000${q}`, 'bybit', diag);
  const lista = d && d.result && d.result.list;
  if (!Array.isArray(lista) || !lista.length) return null;
  return lista.map((k) => [Math.floor(Number(k[0]) / 1000), Number(k[1]), Number(k[2]), Number(k[3]), Number(k[4]), Number(k[5])])
    .sort((a, b) => a[0] - b[0]);
}

async function coinbase(sym, tf, fimSeg, diag) {
  const g = TF_CB[tf];
  if (!g) return null;
  const base = sym.replace('USDT', '');
  const fim = (fimSeg || Math.floor(Date.now() / 1000)) * 1000;
  const ini = fim - 300 * g * 1000;
  const d = await buscar(`https://api.exchange.coinbase.com/products/${base}-USD/candles?granularity=${g}&start=${new Date(ini).toISOString()}&end=${new Date(fim).toISOString()}`, 'coinbase', diag);
  if (!Array.isArray(d) || !d.length) return null;
  return d.map((k) => [Math.floor(Number(k[0])), Number(k[3]), Number(k[2]), Number(k[1]), Number(k[4]), Number(k[5])])
    .sort((a, b) => a[0] - b[0]);
}

const FONTES = [
  { nome: 'kucoin', fn: kucoin },
  { nome: 'okx', fn: okx },
  { nome: 'bybit', fn: bybit },
  { nome: 'coinbase', fn: coinbase },
];

async function serie(sym, tf, alvo, antes) {
  const porTempo = new Map();
  const diag = [];
  let fim = antes || null;
  let fonte = null;
  let pedidos = 0;

  while (pedidos < MAX_PEDIDOS && porTempo.size < alvo) {
    let lote = null;
    for (const f of FONTES) {
      lote = await f.fn(sym, tf, fim, diag);
      if (lote && lote.length) { fonte = f.nome; break; }
    }
    if (!lote || !lote.length) break;

    let novos = 0;
    for (const v of lote) {
      if (!Number.isFinite(v[0]) || !Number.isFinite(v[4])) continue;
      if (antes && v[0] >= antes) continue;
      if (!porTempo.has(v[0])) { porTempo.set(v[0], v); novos++; }
    }
    pedidos++;
    if (!novos) break;
    const menor = lote[0][0];
    if (menor <= 0) break;
    fim = menor - 1;
  }

  const velas = [...porTempo.values()].sort((a, b) => a[0] - b[0]);
  return { velas, fonte, pedidos, diag: diag.slice(-5) };
}

// ── indicadores calculados AQUI, não no navegador ─────────────────────────
function ema(v, n) {
  const k = 2 / (n + 1);
  const out = new Array(v.length);
  out[0] = v[0];
  for (let i = 1; i < v.length; i++) out[i] = v[i] * k + out[i - 1] * (1 - k);
  return out;
}

function sma(v, n) {
  const out = new Array(v.length).fill(null);
  let soma = 0;
  for (let i = 0; i < v.length; i++) {
    soma += v[i];
    if (i >= n) soma -= v[i - n];
    if (i >= n - 1) out[i] = soma / n;
  }
  return out;
}

function rsi(v, n = 14) {
  const out = new Array(v.length).fill(null);
  if (v.length < n + 1) return out;
  let g = 0, l = 0;
  for (let i = 1; i <= n; i++) {
    const d = v[i] - v[i - 1];
    if (d > 0) g += d; else l -= d;
  }
  g /= n; l /= n;
  out[n] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  for (let i = n + 1; i < v.length; i++) {
    const d = v[i] - v[i - 1];
    g = (g * (n - 1) + (d > 0 ? d : 0)) / n;
    l = (l * (n - 1) + (-d > 0 ? -d : 0)) / n;
    out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  return out;
}

function atr(velas, n = 14) {
  const out = new Array(velas.length).fill(null);
  let soma = 0;
  for (let i = 1; i < velas.length; i++) {
    const h = velas[i][2], lo = velas[i][3], pc = velas[i - 1][4];
    const tr = Math.max(h - lo, Math.abs(h - pc), Math.abs(lo - pc));
    if (i <= n) { soma += tr; if (i === n) out[i] = soma / n; }
    else {
      const anterior = out[i - 1] != null ? out[i - 1] : soma / n;
      out[i] = (anterior * (n - 1) + tr) / n;
    }
  }
  return out;
}

function pacote(velas) {
  const closes = velas.map((v) => v[4]);
  const arred = (arr) => arr.map((x) => (x == null ? null : Math.round(x * 100) / 100));
  return {
    ema8: arred(ema(closes, 8)),
    ema16: arred(ema(closes, 16)),
    ema55: arred(ema(closes, 55)),
    ema98: arred(ema(closes, 98)),
    ema200: arred(ema(closes, 200)),
    ma56: arred(sma(closes, 56)),
    ma89: arred(sma(closes, 89)),
    rsi14: arred(rsi(closes, 14)),
    atr14: arred(atr(velas, 14)),
  };
}

// ── tradutor: o que a Binance responde e o navegador nao pode pedir ──────
// As rotas de open interest, funding, long/short, livro e preco da Binance nao
// mandam cabecalho de CORS, entao o navegador descarta a resposta e o painel
// fica vazio. Aqui o servidor pede a OKX, que entrega os mesmos numeros, e
// devolve no formato da Binance. O painel nao precisa saber de nada disso.
const OKX = 'https://www.okx.com/api/v5';

async function okxGet(caminho, diag) {
  const d = await buscar(OKX + caminho, 'okx', diag || []);
  return d && d.data ? d.data : null;
}

function instDe(sym) {
  const base = String(sym || 'BTCUSDT').replace('USDT', '');
  return { spot: base + '-USDT', swap: base + '-USDT-SWAP', base };
}

async function traduzBinance(caminho, q, diag) {
  const sym = q.get('symbol') || 'BTCUSDT';
  const { spot, swap, base } = instDe(sym);
  const agora = Date.now();

  if (caminho.startsWith('/fapi/v1/klines')) {
    const tf = q.get('interval') || '15m';
    const limite = Math.min(Number(q.get('limit') || 500), 1500);
    const r = await serie(sym, tf, limite, null);
    return r.velas.map((v) => [v[0] * 1000, String(v[1]), String(v[2]), String(v[3]), String(v[4]), String(v[5]), v[0] * 1000 + 1, '0', 0, '0', '0', '0']);
  }

  if (caminho.startsWith('/fapi/v1/premiumIndex')) {
    const d = await okxGet(`/public/funding-rate?instId=${swap}`, diag);
    const x = d && d[0];
    if (!x) return null;
    return {
      symbol: sym,
      markPrice: x.markPrice || null,
      indexPrice: null,
      lastFundingRate: x.fundingRate || '0',
      nextFundingTime: Number(x.fundingTime || 0),
      time: agora,
    };
  }

  if (caminho.startsWith('/fapi/v1/openInterest')) {
    const d = await okxGet(`/public/open-interest?instId=${swap}`, diag);
    const x = d && d[0];
    if (!x) return null;
    return { symbol: sym, openInterest: x.oiCcy || x.oi || '0', time: Number(x.ts || agora) };
  }

  if (caminho.startsWith('/futures/data/openInterestHist')) {
    const d = await okxGet(`/rubik/stat/contracts/open-interest-volume?ccy=${base}&period=1H`, diag);
    if (!Array.isArray(d)) return null;
    const limite = Math.min(Number(q.get('limit') || 25), 100);
    return d.slice(-limite).map((x) => ({
      symbol: sym,
      sumOpenInterest: x[1] || '0',
      sumOpenInterestValue: x[2] || '0',
      timestamp: Number(x[0] || agora),
    }));
  }

  if (caminho.startsWith('/futures/data/globalLongShortAccountRatio')) {
    const d = await okxGet(`/rubik/stat/contracts/long-short-account-ratio?ccy=${base}&period=1H`, diag);
    if (!Array.isArray(d) || !d.length) return null;
    const x = d[d.length - 1];
    const razao = Number(x[1] || 1);
    const longo = razao / (1 + razao);
    return [{
      symbol: sym,
      longShortRatio: String(razao),
      longAccount: String(longo.toFixed(4)),
      shortAccount: String((1 - longo).toFixed(4)),
      timestamp: Number(x[0] || agora),
    }];
  }

  if (caminho.startsWith('/fapi/v1/depth')) {
    const lim = Math.min(Number(q.get('limit') || 20), 400);
    const d = await okxGet(`/market/books?instId=${spot}&sz=${lim}`, diag);
    if (!d || !d[0]) return null;
    return {
      lastUpdateId: agora,
      bids: (d[0].bids || []).map((x) => [x[0], x[1]]),
      asks: (d[0].asks || []).map((x) => [x[0], x[1]]),
    };
  }

  if (caminho.startsWith('/fapi/v1/ticker/price')) {
    const d = await okxGet(`/market/ticker?instId=${spot}`, diag);
    const x = d && d[0];
    if (!x) return null;
    return { symbol: sym, price: x.last, time: Number(x.ts || agora) };
  }

  return null;
}

function responder(res, codigo, corpo) {
  const txt = JSON.stringify(corpo);
  res.writeHead(codigo, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'GET, OPTIONS',
    'cache-control': 'public, max-age=20',
    'content-length': Buffer.byteLength(txt),
  });
  res.end(txt);
}

const servidor = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { responder(res, 204, {}); return; }

  const url = new URL(req.url, 'http://' + (req.headers.host || 'local'));
  const rota = url.pathname.replace(/\/+$/, '') || '/';

  if (rota === '/saude' || rota === '/') {
    responder(res, 200, { ok: true, servico: 'vectra-velas', fontes: FONTES.map((f) => f.nome), teto: TETO, cache_ms: CACHE_MS });
    return;
  }

  const sym = normalizaSimbolo(url.searchParams.get('sym'));
  const tf = String(url.searchParams.get('tf') || '15m');
  if (!SEG[tf]) { responder(res, 400, { ok: false, erro: 'tempo nao suportado: ' + tf }); return; }

  if (rota === '/preco') {
    const chave = 'preco|' + sym;
    const g = cache.get(chave);
    if (g && Date.now() - g.em < 5000) { responder(res, 200, { ...g.corpo, cache: true }); return; }
    const d = await buscar(`https://api.kucoin.com/api/v1/market/orderbook/level1?symbol=${sym.replace('USDT', '-USDT')}`, 'kucoin', []);
    const preco = d && d.data ? Number(d.data.price) : null;
    const corpo = { ok: !!preco, sym, preco, em: Date.now() };
    if (preco) cache.set(chave, { em: Date.now(), corpo });
    responder(res, preco ? 200 : 502, corpo);
    return;
  }

  if (rota === '/binance') {
    const caminho = String(url.searchParams.get('p') || '');
    const chave = 'bn|' + caminho + '|' + url.search;
    const g = cache.get(chave);
    if (g && Date.now() - g.em < 15000) { responder(res, 200, { ...g.corpo, cache: true }); return; }
    const diag = [];
    const corpo = await traduzBinance(caminho, url.searchParams, diag);
    if (corpo == null) { responder(res, 502, { ok: false, erro: 'sem dado na fonte', diagnostico: diag.slice(-3) }); return; }
    cache.set(chave, { em: Date.now(), corpo });
    responder(res, 200, corpo);
    return;
  }

  const querPacote = rota === '/pacote';

  if (rota !== '/velas' && !querPacote) { responder(res, 404, { ok: false, erro: 'rota desconhecida' }); return; }

  const alvo = Math.min(Number(url.searchParams.get('alvo') || 4000), TETO);
  const antes = Number(url.searchParams.get('antes') || 0) || null;
  const chave = `${sym}|${tf}|${alvo}|${antes || 0}` + (rota === '/pacote' ? '|p' : '');

  const guardado = cache.get(chave);
  if (guardado && Date.now() - guardado.em < CACHE_MS) {
    responder(res, 200, { ...guardado.corpo, cache: true });
    return;
  }

  try {
    const r = await serie(sym, tf, alvo, antes);
    const corpo = {
      ok: r.velas.length > 0,
      sym, tf,
      total: r.velas.length,
      desde: r.velas.length ? r.velas[0][0] : null,
      ate: r.velas.length ? r.velas[r.velas.length - 1][0] : null,
      fonte: r.fonte,
      pedidos: r.pedidos,
      cache: false,
      diagnostico: r.diag,
      velas: r.velas,
    };
    if (querPacote && r.velas.length) corpo.indicadores = pacote(r.velas);
    if (r.velas.length) cache.set(chave + (querPacote ? '|p' : ''), { em: Date.now(), corpo });
    responder(res, r.velas.length ? 200 : 502, corpo);
  } catch (e) {
    responder(res, 500, { ok: false, erro: String(e && e.message || e) });
  }
});

// limpeza do cache: nada fica guardado por mais de 10 minutos
setInterval(() => {
  const agora = Date.now();
  for (const [k, v] of cache) if (agora - v.em > 600000) cache.delete(k);
}, 120000).unref();

servidor.listen(PORTA, () => {
  console.log(`vectra-velas ouvindo na porta ${PORTA}`);
});
