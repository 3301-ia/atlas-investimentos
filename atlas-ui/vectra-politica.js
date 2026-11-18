// vectraPolitica — o cérebro que lê todos os indicadores ao mesmo tempo e decide
// pela POLÍTICA, não por um indicador solto.
// Por tempo: faixas de 20 e 50 velas, EMAs 8/16/50/200, RSI 14, ATR, estrutura
// de topos e fundos, perna de Fibo (âncora zero e um), régua de terços, exaustão
// e o toque na 200 (sobe, fica verde e volta = venda; desce, fica vermelho e
// volta = compra). Grava tudo em VectraLeitura, uma linha por vela fechada.
// Perfis: conservador, equilibrado, agressivo.

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.63';

const ATIVOS = ['BTCUSDT', 'ETHUSDT', 'ZECUSDT'];
const TEMPOS = ['5m', '15m', '1h', '4h', '1d'];
const PAR = { BTCUSDT: 'BTC-USDT', ETHUSDT: 'ETH-USDT', ZECUSDT: 'ZEC-USDT' };
const CB = { BTCUSDT: 'BTC-USD', ETHUSDT: 'ETH-USD', ZECUSDT: 'ZEC-USD' };
const KR = { BTCUSDT: 'XBTUSD', ETHUSDT: 'ETHUSD', ZECUSDT: 'ZECUSD' };
const KC = { '5m': '5min', '15m': '15min', '1h': '1hour', '4h': '4hour', '1d': '1day' };
const OKB = { '5m': '5m', '15m': '15m', '1h': '1H', '4h': '4H', '1d': '1D' };
const CBR = { '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400 };
const KRR = { '5m': 5, '15m': 15, '1h': 60, '4h': 240, '1d': 1440 };
const REGUA = [-0.333, 0, 0.333, 0.666, 0.999, 1.333, 1.666];

const PERFIS: any = {
  conservador: { exigeTempos: 4, exigeAlinhamento: true, exaustaoMax: 35, aceitaFade: false, riscoPct: 0.5 },
  equilibrado: { exigeTempos: 3, exigeAlinhamento: true, exaustaoMax: 55, aceitaFade: true, riscoPct: 1 },
  agressivo: { exigeTempos: 2, exigeAlinhamento: false, exaustaoMax: 70, aceitaFade: true, riscoPct: 2 },
};

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS', 'Content-Type': 'application/json' };
const json = (c: unknown, s = 200) => new Response(JSON.stringify(c), { status: s, headers: cors });
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
const r2 = (v: number) => Number(v.toFixed(2));

async function buscar(url: string) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 9000);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'VECTRA/1.0' }, signal: ctl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

// janela suficiente para a EMA 200 respirar
async function velas(ativo: string, tf: string) {
  const erros: string[] = [];
  const agora = Math.floor(Date.now() / 1000);
  try {
    const jan = CBR[tf] * 320;
    const j = await buscar(`https://api.kucoin.com/api/v1/market/candles?type=${KC[tf]}&symbol=${PAR[ativo]}&startAt=${agora - jan}&endAt=${agora}`);
    const d = (j?.data || []).map((c: string[]) => ({ t: +c[0] * 1000, o: +c[1], c: +c[2], h: +c[3], l: +c[4] }));
    if (d.length >= 200) return d.sort((a: any, b: any) => a.t - b.t);
    erros.push('kucoin ' + d.length);
  } catch (e) { erros.push('kucoin ' + (e as Error).message); }
  try {
    const j = await buscar(`https://api.kraken.com/0/public/OHLC?pair=${KR[ativo]}&interval=${KRR[tf]}`);
    const res = j?.result || {};
    const chave = Object.keys(res).find((k) => k !== 'last');
    const d = (chave ? res[chave] : []).map((c: any[]) => ({ t: +c[0] * 1000, o: +c[1], h: +c[2], l: +c[3], c: +c[4] }));
    if (d.length >= 200) return d.sort((a: any, b: any) => a.t - b.t);
    erros.push('kraken ' + d.length);
  } catch (e) { erros.push('kraken ' + (e as Error).message); }
  try {
    const j = await buscar(`https://api.exchange.coinbase.com/products/${CB[ativo]}/candles?granularity=${CBR[tf]}&start=${agora - CBR[tf] * 300}&end=${agora}`);
    const d = j.map((c: number[]) => ({ t: c[0] * 1000, o: c[3], c: c[4], h: c[2], l: c[1] }));
    if (d.length >= 200) return d.sort((a: any, b: any) => a.t - b.t);
    erros.push('coinbase ' + d.length);
  } catch (e) { erros.push('coinbase ' + (e as Error).message); }
  throw new Error(erros.join(' | '));
}

function ema(s: number[], n: number) {
  const k = 2 / (n + 1);
  let e = s[0];
  return s.map((x, i) => (i === 0 ? (e = x) : (e = x * k + e * (1 - k))));
}
function rsi(s: number[], n = 14) {
  let g = 0, p = 0;
  const out: (number | null)[] = new Array(s.length).fill(null);
  for (let i = 1; i < s.length; i++) {
    const d = s[i] - s[i - 1], up = Math.max(d, 0), dn = Math.max(-d, 0);
    if (i <= n) { g += up / n; p += dn / n; } else { g = (g * (n - 1) + up) / n; p = (p * (n - 1) + dn) / n; }
    if (i >= n && p > 0) out[i] = 100 - 100 / (1 + g / p);
  }
  return out;
}
const lim = (x: number) => Math.max(0, Math.min(100, x));

function pivos(v: any[]) {
  const altos: number[] = [], baixos: number[] = [];
  for (let i = 3; i < v.length - 3; i++) {
    const jan = v.slice(i - 3, i + 4);
    if (v[i].h === Math.max(...jan.map((x) => x.h))) altos.push(i);
    if (v[i].l === Math.min(...jan.map((x) => x.l))) baixos.push(i);
  }
  return { altos, baixos };
}
function estrutura(v: any[], altos: number[], baixos: number[]) {
  const H = altos.slice(-2).map((i) => v[i].h), L = baixos.slice(-2).map((i) => v[i].l);
  if (H.length < 2 || L.length < 2) return 'indefinida';
  if (H[1] > H[0] && L[1] > L[0]) return 'topos e fundos ascendentes';
  if (H[1] < H[0] && L[1] < L[0]) return 'topos e fundos descendentes';
  return 'lateral';
}

function analisa(v: any[]) {
  const c = v.map((x) => x.c);
  const e8 = ema(c, 8), e16 = ema(c, 16), e50 = ema(c, 50), e200 = ema(c, 200), r = rsi(c, 14);
  const i = c.length - 1, preco = c[i];
  const { altos, baixos } = pivos(v);
  const est = estrutura(v, altos, baixos);
  const ultAlto = altos.length ? altos[altos.length - 1] : i;
  const ultBaixo = baixos.length ? baixos[baixos.length - 1] : i;
  let zero: number, um: number, lado: string;
  if (ultBaixo < ultAlto) { zero = v[ultBaixo].l; um = v[ultAlto].h; lado = 'alta'; }
  else { zero = v[ultAlto].h; um = v[ultBaixo].l; lado = 'baixa'; }
  const perna = Math.abs(um - zero) || 1;
  const pos = lado === 'alta' ? (preco - zero) / perna : (zero - preco) / perna;
  const nivel = REGUA.reduce((a, b) => (Math.abs(b - pos) < Math.abs(a - pos) ? b : a), REGUA[0]);
  const zona = Math.abs(nivel - pos) <= 0.06
    ? String(nivel).replace('.', ',')
    : 'entre ' + String(REGUA.filter((x) => x < pos).slice(-1)[0]).replace('.', ',') + ' e ' + String(REGUA.find((x) => x > pos) ?? 'acima').replace('.', ',');

  let toque = 'longe';
  for (let k = i; k >= Math.max(1, i - 5); k--) {
    if (c[k] > e200[k] && c[k - 1] <= e200[k - 1] && preco < e200[i]) { toque = 'tocou a 200 por cima e voltou'; break; }
    if (c[k] < e200[k] && c[k - 1] >= e200[k - 1] && preco > e200[i]) { toque = 'tocou a 200 por baixo e voltou'; break; }
  }

  const dist200 = ((preco - e200[i]) / e200[i]) * 100;
  const tr = v.slice(-15).map((x, k, arr) => k === 0 ? x.h - x.l : Math.max(x.h - x.l, Math.abs(x.h - arr[k - 1].c), Math.abs(x.l - arr[k - 1].c)));
  const atr = tr.reduce((a, b) => a + b, 0) / tr.length;

  const exaustao = Math.round(
    lim((Math.abs((r[i] ?? 50) - 50) - 20) * 4) * 0.4 +
    lim((Math.abs(dist200) - 3) * 8) * 0.35 +
    lim((pos > 1 ? (pos - 1) * 120 : pos < 0 ? -pos * 120 : 0)) * 0.25
  );

  let tendencia = 'lateral';
  if (est.includes('ascendentes') && preco > e200[i]) tendencia = 'alta';
  else if (est.includes('descendentes') && preco < e200[i]) tendencia = 'baixa';
  else if (preco > e200[i] && e8[i] > e16[i] && e16[i] > e50[i]) tendencia = 'alta';
  else if (preco < e200[i] && e8[i] < e16[i] && e16[i] < e50[i]) tendencia = 'baixa';

  const faixa = (n: number) => ({ hi: Math.max(...v.slice(-n - 1, -1).map((x) => x.h)), lo: Math.min(...v.slice(-n - 1, -1).map((x) => x.l)) });
  const f20 = faixa(20), f50 = faixa(50);

  return {
    vela_em: new Date(v[i].t).toISOString(), fechamento: r2(preco), maxima: r2(v[i].h), minima: r2(v[i].l),
    ema8: r2(e8[i]), ema16: r2(e16[i]), ema50: r2(e50[i]), ema200: r2(e200[i]),
    rsi14: r[i] ? r2(r[i]!) : null, atr: r2(atr),
    faixa20_alta: r2(f20.hi), faixa20_baixa: r2(f20.lo), faixa50_alta: r2(f50.hi), faixa50_baixa: r2(f50.lo),
    estrutura: est, tendencia, fibo_zero: r2(zero), fibo_um: r2(um), fibo_pos: Number(pos.toFixed(3)),
    fibo_zona: zona, exaustao, distancia_200: Number(dist200.toFixed(2)), toque_200: toque,
  };
}

function decide(l: any, perfil: any) {
  const p = l.fibo_pos, ex = l.exaustao;
  const m: string[] = [];
  let sinal = 'AGUARDAR';
  const exaustoVenda = l.tendencia === 'baixa' && ex >= 75;
  const exaustoCompra = l.tendencia === 'alta' && ex >= 75;

  if (exaustoVenda && perfil.aceitaFade) {
    sinal = 'COMPRA';
    m.push(`exaustão ${ex} na baixa: abre a ponta compradora contra a tendência`);
    m.push(`alvo na retração 0,333 da perna (${l.fibo_zero} → ${l.fibo_um})`);
  } else if (exaustoCompra && perfil.aceitaFade) {
    sinal = 'VENDA';
    m.push(`exaustão ${ex} na alta: abre a ponta vendedora contra a tendência`);
    m.push(`alvo na retração 0,333 da perna (${l.fibo_zero} → ${l.fibo_um})`);
  } else if (l.tendencia === 'baixa' && ex <= perfil.exaustaoMax) {
    if (p >= 0.4 && p <= 0.75) { sinal = 'VENDA'; m.push(`vende na retração ${l.fibo_zona} a favor dos alvos`); }
    else if (p < 0) { sinal = 'VENDA'; m.push('quebra estrutural: preço abaixo do zero da perna, vende a favor dos alvos'); }
    else if (l.toque_200.includes('por cima')) { sinal = 'VENDA'; m.push('tocou a 200 por cima e voltou: fica vermelho, é long da baixa'); }
    else m.push(`tendência de baixa, preço em ${l.fibo_zona}: espera a retração`);
  } else if (l.tendencia === 'alta' && ex <= perfil.exaustaoMax) {
    if (p >= 0.25 && p <= 0.6) { sinal = 'COMPRA'; m.push(`compra na retração ${l.fibo_zona} a favor dos alvos`); }
    else if (p > 1) { sinal = 'COMPRA'; m.push('rompeu o um da perna: continuação a favor dos alvos'); }
    else if (l.toque_200.includes('por baixo')) { sinal = 'COMPRA'; m.push('tocou a 200 por baixo e voltou: fica verde, é long da alta'); }
    else m.push(`tendência de alta, preço em ${l.fibo_zona}: espera a retração`);
  } else if (l.tendencia === 'lateral') {
    m.push('estrutura lateral: sem perna definida, fica de fora');
  } else {
    m.push(`exaustão ${ex} acima do limite do perfil ${perfil.nome}: não entra`);
  }
  if (l.toque_200 !== 'longe' && sinal !== 'AGUARDAR') m.push('confirmação: ' + l.toque_200);
  return { sinal, motivo: m.join(' | ') };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  try {
    const corpo = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const ativos = Array.isArray(corpo.ativos) && corpo.ativos.length ? corpo.ativos : ATIVOS;
    const perfilNome = String(corpo.perfil || 'equilibrado');
    const perfil = { ...(PERFIS[perfilNome] || PERFIS.equilibrado), nome: perfilNome };
    const salvar = corpo.salvar !== false;
    const base44 = createClientFromRequest(req);
    const dbL = base44.asServiceRole.entities.VectraLeitura;

    const saida: any[] = [];
    for (const ativo of ativos) {
      const leituras: any = {};
      for (const tf of TEMPOS) {
        try {
          const l = analisa(await velas(ativo, tf));
          const d = decide(l, perfil);
          leituras[tf] = { ...l, sinal: d.sinal, motivo: d.motivo };
          if (salvar) {
            const ult = await dbL.filter({ ativo, tempo: tf }, { sort: '-vela_em', limit: 1 });
            const ultimo = (ult.items ?? ult)[0];
            if (!ultimo || ultimo.vela_em !== l.vela_em) await dbL.create({ ativo, tempo: tf, ...l, sinal: d.sinal, motivo: d.motivo });
          }
        } catch (e) {
          leituras[tf] = { erro: String((e as Error).message) };
        }
        await dormir(120);
      }

      const validos = Object.entries(leituras).filter(([, l]: any) => !l.erro) as [string, any][];
      const compra = validos.filter(([, l]) => l.sinal === 'COMPRA').length;
      const venda = validos.filter(([, l]) => l.sinal === 'VENDA').length;
      const tend = validos.map(([, l]) => l.tendencia);
      const alinhado = tend.length > 0 && tend.every((t) => t === tend[0]);

      let acao = 'AGUARDAR';
      if (compra >= perfil.exigeTempos && (!perfil.exigeAlinhamento || alinhado)) acao = 'ABRIR COMPRA';
      else if (venda >= perfil.exigeTempos && (!perfil.exigeAlinhamento || alinhado)) acao = 'ABRIR VENDA';

      const base = leituras['15m'] && !leituras['15m'].erro ? leituras['15m'] : validos[0]?.[1];
      const riscoUsd = 100 * (perfil.riscoPct / 100);
      const stopDist = base ? Math.max(base.atr * 1.5, Math.abs(base.fechamento - base.fibo_zero) * 0.5) : 0;

      saida.push({
        ativo, perfil: perfilNome, acao, compra, venda, tempos_lidos: validos.length, alinhado,
        preco: base?.fechamento ?? null, risco_usd: r2(riscoUsd),
        tamanho: stopDist ? Number((riscoUsd / stopDist).toFixed(6)) : 0,
        stop: base && stopDist ? r2(acao === 'ABRIR VENDA' ? base.fechamento + stopDist : base.fechamento - stopDist) : null,
        leituras,
      });
      await dormir(150);
    }

    return json({ ok: true, perfil: perfilNome, em: new Date().toISOString(), regua: REGUA, resultado: saida });
  } catch (e) { return json({ ok: false, erro: String((e as Error).message) }, 500); }
});
