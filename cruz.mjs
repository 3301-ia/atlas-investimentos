import fs from 'node:fs';
import { ema } from '/tmp/at/atlas-ui/core/indicators.js';
import { imperial } from '/tmp/at/atlas-ui/core/imperial.js';
import { fiboPlan } from '/tmp/at/atlas-ui/core/fibonacci.js';

async function velas(bar, limite) {
  let out = [], after = '';
  while (out.length < limite) {
    const u = 'https://www.okx.com/api/v5/market/history-candles?instId=BTC-USDT&bar=' + bar + '&limit=100' + (after ? '&after=' + after : '');
    const j = await (await fetch(u)).json();
    if (!j.data || !j.data.length) break;
    out.push(...j.data); after = j.data[j.data.length - 1][0];
  }
  const vis = new Set();
  return out.filter(x => (vis.has(x[0]) ? false : (vis.add(x[0]), true)))
    .map(x => ({ time: Math.floor(+x[0] / 1000), t: Math.floor(+x[0] / 1000), o: +x[1], open: +x[1], h: +x[2], high: +x[2], l: +x[3], low: +x[3], c: +x[4], close: +x[4], v: +x[5], vol: +x[5] }))
    .sort((a, b) => a.time - b.time).slice(0, -1);
}

const serie = {};
for (const [k, bar, n] of [['5m', '5m', 1000], ['15m', '15m', 700], ['1H', '1H', 700]]) serie[k] = await velas(bar, n);

// lado EMA 8/16 por tempo, indexado pelo tempo da vela
function ladosEma(v) {
  const r = ema(v.map(x => x.c), 8), l = ema(v.map(x => x.c), 16);
  const m = new Map();
  for (let i = 0; i < v.length; i++) if (r[i] != null && l[i] != null) m.set(v[i].time, r[i] > l[i] ? 'alta' : 'baixa');
  return m;
}
const lado = { '15m': ladosEma(serie['15m']), '1H': ladosEma(serie['1H']) };

// Imperial: lado da nuvem por tempo
function ladoImperial(v) {
  const im = imperial(v);
  const m = new Map();
  if (!im || !im.series || !im.series.dir) return m;
  for (let i = 0; i < v.length; i++) if (im.series.dir[i] != null) m.set(v[i].time, im.series.dir[i] === 1 ? 'alta' : 'baixa');
  return m;
}
const imp = { '15m': ladoImperial(serie['15m']), '1H': ladoImperial(serie['1H']) };

// Fibo: planos recalculados de hora em hora no 15m, guardando o plano vigente
function planosFibo(v, passo) {
  const lista = [];
  for (let i = 60; i < v.length; i += passo) {
    const f = fiboPlan(v.slice(0, i));
    if (f) lista.push({ tempo: v[i - 1].time, plano: f });
  }
  return lista;
}
const fibos = planosFibo(serie['15m'], 4);
function fiboNo(tempo) {
  let achado = null;
  for (const f of fibos) { if (f.tempo <= tempo) achado = f.plano; else break; }
  return achado;
}

// gatilhos no 5m: cruzamento EMA 8/16
const c5 = serie['5m'];
const e8 = ema(c5.map(x => x.c), 8), e16 = ema(c5.map(x => x.c), 16);
const sinais = [];
for (let i = 1; i < c5.length; i++) {
  if (e8[i] == null || e16[i] == null || e8[i - 1] == null || e16[i - 1] == null) continue;
  const cruzouAlta = e8[i - 1] <= e16[i - 1] && e8[i] > e16[i];
  const cruzouBaixa = e8[i - 1] >= e16[i - 1] && e8[i] < e16[i];
  if (!cruzouAlta && !cruzouBaixa) continue;
  const l = cruzouAlta ? 'alta' : 'baixa';
  const tempo = c5[i].time, preco = c5[i].c;
  const conf = [];
  if (lado['15m'].get(tempo) === l) conf.push('EMA15m');
  if (lado['1H'].get(tempo) === l) conf.push('EMA1H');
  if (imp['15m'].get(tempo) === l) conf.push('Imp15m');
  if (imp['1H'].get(tempo) === l) conf.push('Imp1H');
  const f = fiboNo(tempo);
  let fiboFavor = null, alvoFibo = null;
  if (f) {
    const bateu = l === f.lado;
    if (bateu) conf.push('Fibo');
    const prox = f.niveis.find(n => (l === 'alta' ? n.preco > preco : n.preco < preco));
    fiboFavor = bateu; alvoFibo = prox ? prox.preco : null;
  }
  // resultado 4h (48 velas de 5m)
  const j = i + 48;
  let resultado = null, maxima = null, minima = null;
  if (j < c5.length) {
    maxima = Math.max(...c5.slice(i, j + 1).map(x => x.h));
    minima = Math.min(...c5.slice(i, j + 1).map(x => x.l));
    const mov = (c5[j].c - preco) / preco * 100;
    resultado = l === 'alta' ? mov : -mov;
  }
  sinais.push({
    tempo, hora: new Date(tempo * 1000).toISOString().slice(5, 16).replace('T', ' '), lado: l, preco,
    confluencias: conf, n: conf.length, resultado, maxima, minima, alvoFibo,
    p0: f ? f.p0 : null, p1: f ? f.p1 : null
  });
}

// métrica por número de confluências
const grupos = {};
for (const s of sinais) {
  if (s.resultado == null) continue;
  const g = grupos[s.n] || (grupos[s.n] = { n: 0, soma: 0, acerto: 0 });
  g.n++; g.soma += s.resultado; if (s.resultado > 0) g.acerto++;
}
console.log('sinais de 5m com resultado medido:', sinais.filter(s => s.resultado != null).length, 'de', sinais.length);
Object.keys(grupos).sort().forEach(k => {
  const g = grupos[k];
  console.log('  ' + k + ' confluencias: ' + String(g.n).padStart(2) + ' sinais | media ' + (g.soma / g.n).toFixed(3) + '% | acerto ' + Math.round(g.acerto / g.n * 100) + '%');
});
const quatro = sinais.filter(s => s.n >= 3 && s.resultado != null);
const tres = sinais.filter(s => s.n === 2 && s.resultado != null);
console.log('  4+ confluencias: ' + quatro.length + ' sinais, media ' + (quatro.reduce((a, b) => a + b.resultado, 0) / (quatro.length || 1)).toFixed(3) + '%');
console.log('  exatamente 2: ' + tres.length + ' sinais, media ' + (tres.reduce((a, b) => a + b.resultado, 0) / (tres.length || 1)).toFixed(3) + '%');

fs.writeFileSync('/tmp/cruz_out.json', JSON.stringify({ gerado: new Date().toISOString(), sinais, grupos }, null, 1));
