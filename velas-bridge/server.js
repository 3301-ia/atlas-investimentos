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

const SEG = { '1m': 60, '3m': 180, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '2h': 7200, '4h': 14400, '6h': 21600, '8h': 28800, '12h': 43200, '1d': 86400, '1w': 604800 };
const TF_KC = { '1m': '1min', '3m': '3min', '5m': '5min', '15m': '15min', '30m': '30min', '1h': '1hour', '2h': '2hour', '4h': '4hour', '8h': '8hour', '12h': '12hour', '1d': '1day', '1w': '1week' };
const TF_OKX = { '1m': '1m', '5m': '5m', '15m': '15m', '30m': '30m', '1h': '1H', '2h': '2H', '4h': '4H', '6h': '6H', '12h': '12H', '1d': '1D' };
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

  if (rota !== '/velas') { responder(res, 404, { ok: false, erro: 'rota desconhecida' }); return; }

  const alvo = Math.min(Number(url.searchParams.get('alvo') || 4000), TETO);
  const antes = Number(url.searchParams.get('antes') || 0) || null;
  const chave = `${sym}|${tf}|${alvo}|${antes || 0}`;

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
    if (r.velas.length) cache.set(chave, { em: Date.now(), corpo });
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
