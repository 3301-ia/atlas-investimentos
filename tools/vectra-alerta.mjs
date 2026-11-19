// VECTRA · alerta de graça, rodando no GitHub Actions
// Sem Base44, sem Render, sem serviço pago: só a API pública da corretora e o Telegram.
//
// O que ele faz a cada rodada:
//   1. busca velas de 1m, 15m, 1h, 4h e 1d (KuCoin -> OKX -> Coinbase)
//   2. calcula EMA 8/16/50/200, RSI 14 e ATR 14
//   3. acha cruzamento EMA8 x EMA16 na última vela fechada
//   4. filtra pela condição macro (preço contra a EMA200 no 4h e no 1d)
//   5. amostra o preço de 15 em 15 segundos (gatilho rápido 15s/30s)
//   6. vigia os níveis de stop e de alvo da posição
//   7. manda no Telegram só quando tem coisa nova
//
// Uso: TELEGRAM_TOKEN=... TELEGRAM_CHAT_ID=... node tools/vectra-alerta.mjs

import fs from 'node:fs';
import path from 'node:path';

const ATIVO = 'BTCUSDT';
const LOTE = 0.01;              // 1 ponto de preço = 0,01 USD
const RISCO_USD = 1.0;          // stop do giro
const NIVEL_STOP = 62550;       // stop da posição comprada
const NIVEL_TP1 = 63295;        // TP1 da posição comprada
const GATILHO_ALTO = 74100;     // gatilho de referência
const AMOSTRAS = 4;             // 4 x 15s = 1 minuto de amostragem
const PASSO_MS = 15000;
const ESTADO = path.join(process.cwd(), 'tools', 'vectra-estado.json');

const TOKEN = process.env.TELEGRAM_TOKEN || '';
const CHAT = process.env.TELEGRAM_CHAT_ID || '';

const SEG = { '1m': 60, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400 };
const TIPO_KC = { '1m': '1min', '15m': '15min', '1h': '1hour', '4h': '4hour', '1d': '1day' };
const BAR_OKX = { '1m': '1m', '15m': '15m', '1h': '1H', '4h': '4H', '1d': '1D' };
const GRAN_CB = { '1m': 60, '15m': 900, '1h': 3600, '1d': 86400 };

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

function ema(v, n) {
  const k = 2 / (n + 1);
  const out = [v[0]];
  for (let i = 1; i < v.length; i++) out.push(v[i] * k + out[i - 1] * (1 - k));
  return out;
}

function rsi(v, n = 14) {
  if (v.length < n + 2) return 50;
  let g = 0, l = 0;
  for (let i = 1; i <= n; i++) {
    const d = v[i] - v[i - 1];
    if (d > 0) g += d; else l -= d;
  }
  g /= n; l /= n;
  for (let i = n + 1; i < v.length; i++) {
    const d = v[i] - v[i - 1];
    g = (g * (n - 1) + (d > 0 ? d : 0)) / n;
    l = (l * (n - 1) + (-d > 0 ? -d : 0)) / n;
  }
  return l === 0 ? 100 : 100 - 100 / (1 + g / l);
}

function atr(c, n = 14) {
  const tr = [];
  for (let i = 1; i < c.length; i++) {
    tr.push(Math.max(c[i][2] - c[i][3], Math.abs(c[i][2] - c[i - 1][4]), Math.abs(c[i][3] - c[i - 1][4])));
  }
  const u = tr.slice(-n);
  return u.reduce((a, b) => a + b, 0) / (u.length || 1);
}

async function pegar(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 9000);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { accept: 'application/json' } });
    const j = await r.json();
    if (Array.isArray(j)) return j;
    if (Array.isArray(j?.data)) return j.data;
    if (j?.data && typeof j.data === 'object') return [j.data];
    return [];
  } catch {
    return [];
  } finally {
    clearTimeout(t);
  }
}

async function velas(tf) {
  const agora = Math.floor(Date.now() / 1000);
  const mapa = new Map();
  const fontes = [
    { url: `https://api.kucoin.com/api/v1/market/candles?type=${TIPO_KC[tf]}&symbol=${ATIVO.replace('USDT', '-USDT')}`, ordem: [0, 1, 2, 3, 4] },
    { url: `https://www.okx.com/api/v5/market/candles?instId=BTC-USDT&bar=${BAR_OKX[tf]}&limit=300`, ordem: [0, 1, 2, 3, 4] },
  ];
  if (GRAN_CB[tf]) {
    fontes.push({ url: `https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=${GRAN_CB[tf]}`, ordem: [0, 3, 2, 1, 4] });
  }
  for (const f of fontes) {
    if (mapa.size >= 210) break;
    for (let k = 0; k < 2; k++) {
      const linhas = await pegar(f.url);
      if (!linhas.length) { await dormir(600); continue; }
      for (const x of linhas) {
        let t = Number(x[f.ordem[0]]);
        if (!t) continue;
        if (t > 1e12) t = Math.floor(t / 1000);
        mapa.set(t, [t, Number(x[f.ordem[1]]), Number(x[f.ordem[2]]), Number(x[f.ordem[3]]), Number(x[f.ordem[4]])]);
      }
      break;
    }
  }
  const arr = [...mapa.values()].sort((a, b) => a[0] - b[0]);
  while (arr.length && arr[arr.length - 1][0] + SEG[tf] > agora) arr.pop(); // tira a vela em formação
  return arr;
}

async function lerTempo(tf) {
  const c = await velas(tf);
  if (c.length < 30) return { tf, ok: false, velas: c.length };
  const f = c.map((x) => x[4]);
  const e8 = ema(f, 8), e16 = ema(f, 16);
  const n = c.length - 1;
  const e50 = f.length >= 50 ? ema(f, 50)[n] : null;
  const e200 = f.length >= 200 ? ema(f, 200)[n] : null;
  const acima = e8[n] > e16[n];
  const antes = e8[n - 1] > e16[n - 1];
  let cruz = null;
  if (acima && !antes) cruz = 'alta';
  if (!acima && antes) cruz = 'baixa';
  return {
    tf, ok: true, velas: c.length,
    preco: +f[n].toFixed(1),
    e8: +e8[n].toFixed(1), e16: +e16[n].toFixed(1),
    e50: e50 ? +e50.toFixed(1) : null, e200: e200 ? +e200.toFixed(1) : null,
    rsi: +rsi(f).toFixed(1), atr: +atr(c).toFixed(1),
    vies: acima ? 'alta' : 'baixa', cruz,
    vela: c[n][0],
  };
}

async function micro() {
  const serie = [];
  for (let i = 0; i < AMOSTRAS; i++) {
    let p = 0;
    const l1 = await pegar('https://api.kucoin.com/api/v1/market/orderbook/level1?symbol=BTC-USDT');
    p = Number(l1?.[0]?.price) || 0;
    if (!p) {
      const l2 = await pegar('https://www.okx.com/api/v5/market/ticker?instId=BTC-USDT');
      p = Number(l2?.[0]?.last) || 0;
    }
    if (p) serie.push(p);
    if (i < AMOSTRAS - 1) await dormir(PASSO_MS);
  }
  if (serie.length < 3) return { ok: false, amostras: serie.length };
  const n = serie.length - 1;
  const acima = serie[n] > serie[0];
  return {
    ok: true, amostras: serie.length,
    primeiro: serie[0], ultimo: serie[n],
    variacao: +(((serie[n] - serie[0]) / serie[0]) * 100).toFixed(3),
    vies: acima ? 'alta' : 'baixa',
    cruz: acima !== (serie[n - 1] > serie[0]) ? (acima ? 'alta' : 'baixa') : null,
  };
}

function lerEstado() {
  try { return JSON.parse(fs.readFileSync(ESTADO, 'utf8')); } catch { return { alertados: {}, niveis: {} }; }
}

function salvarEstado(e) {
  fs.mkdirSync(path.dirname(ESTADO), { recursive: true });
  fs.writeFileSync(ESTADO, JSON.stringify(e, null, 2) + '\n');
}

const brl = (v) => v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

async function telegram(texto) {
  if (!TOKEN || !CHAT) {
    console.log('[sem TELEGRAM_TOKEN/TELEGRAM_CHAT_ID] mensagem que sairia:\n' + texto);
    return false;
  }
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT, text: texto, disable_web_page_preview: true }),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) { console.log('telegram falhou: ' + JSON.stringify(j).slice(0, 300)); return false; }
  return true;
}

async function main() {
  const estado = lerEstado();
  estado.alertados = estado.alertados || {};
  estado.niveis = estado.niveis || {};
  let mudou = false;

  const t1m = await lerTempo('1m');
  const t15 = await lerTempo('15m');
  const t1h = await lerTempo('1h');
  const t4h = await lerTempo('4h');
  const t1d = await lerTempo('1d');
  const m = await micro();

  const preco = t1m.preco || t15.preco || 0;
  const ladoMacro = (t) => {
    if (!t.ok) return 'indefinida';
    if (t.e200) return t.preco > t.e200 ? 'compra' : 'venda';
    return t.preco > t.e16 ? 'compra' : 'venda';
  };
  const macro4 = ladoMacro(t4h);
  const macro1d = ladoMacro(t1d);
  const macro = macro4 === macro1d ? macro4 : 'conflito';

  const linhas = [];
  for (const t of [t1m, t15, t1h, t4h, t1d]) {
    if (!t.ok || !t.cruz) continue;
    if (estado.alertados[t.tf] === t.vela) continue;
    const alinhado = (t.cruz === 'alta' && macro === 'compra') || (t.cruz === 'baixa' && macro === 'venda');
    if (!alinhado) { estado.alertados[t.tf] = t.vela; mudou = true; continue; }
    estado.alertados[t.tf] = t.vela;
    mudou = true;

    const base = t15.ok ? t15 : t1m;
    const dir = t.cruz === 'baixa' ? -1 : 1;
    const entrada = base.preco;
    const A = base.atr || 100;
    linhas.push(
      `VECTRA · cruzamento de ${t.cruz.toUpperCase()} no ${t.tf}\n` +
      `Entrada ${brl(entrada)} · stop ${brl(entrada - dir * (RISCO_USD / LOTE))} (${RISCO_USD.toFixed(2)} USD)\n` +
      `TP1 ${brl(entrada + dir * A)} (${(A * LOTE).toFixed(2)}) · TP2 ${brl(entrada + dir * A * 2)} (${(A * LOTE * 2).toFixed(2)}) · TP3 ${brl(entrada + dir * A * 3)} (${(A * LOTE * 3).toFixed(2)})\n` +
      `Macro ${macro} (4h ${macro4} · 1d ${macro1d}) · ATR15m ${brl(A)}`
    );
  }

  if (preco <= NIVEL_STOP && !estado.niveis.stop) {
    estado.niveis.stop = true; mudou = true;
    linhas.push(`VECTRA · preço ${brl(preco)} tocou o stop ${brl(NIVEL_STOP)} da compra.`);
  } else if (preco > NIVEL_STOP + 50 && estado.niveis.stop) {
    estado.niveis.stop = false; mudou = true;
  }
  if (preco >= NIVEL_TP1 && !estado.niveis.tp1) {
    estado.niveis.tp1 = true; mudou = true;
    linhas.push(`VECTRA · preço ${brl(preco)} tocou o TP1 ${brl(NIVEL_TP1)} da compra.`);
  } else if (preco < NIVEL_TP1 - 50 && estado.niveis.tp1) {
    estado.niveis.tp1 = false; mudou = true;
  }

  const dist = +(GATILHO_ALTO - preco).toFixed(1);
  let enviados = 0;
  for (const l of linhas) {
    const texto = `${l}\nPreço agora ${brl(preco)} · falta ${brl(dist)} até ${brl(GATILHO_ALTO)}`;
    if (await telegram(texto)) enviados++;
  }

  if (mudou) salvarEstado(estado);

  console.log(JSON.stringify({
    preco, macro, macro4, macro1d,
    tempos: { '1m': t1m.vies, '15m': t15.vies, '1h': t1h.vies, '4h': t4h.vies, '1d': t1d.vies },
    rsi: { '1m': t1m.rsi, '15m': t15.rsi, '1h': t1h.rsi, '4h': t4h.rsi, '1d': t1d.rsi },
    micro: m, alertas: linhas.length, enviados, dist_gatilho: dist,
  }, null, 2));
}

main().catch((e) => { console.error('erro:', e); process.exit(1); });
