import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import * as fibo from './fibonacci.js';

let ok = 0, falhas = 0;
const t = (n, c, x) => { if (c) { ok++; console.log('  ok  ' + n); } else { falhas++; console.log('  FALHA ' + n + (x ? ' :: ' + x : '')); } };

// serie sintetica: sobe, corrige, retoma, para gerar pivo e cruzamento
const velas = [];
let p = 100;
for (let i = 0; i < 160; i++) {
  const passo = i < 40 ? 1.2 : i < 70 ? -0.9 : 1.4;
  const o = p, c = p + passo, h = Math.max(o, c) + 0.5, l = Math.min(o, c) - 0.5;
  velas.push({ time: 1700000000 + i * 3600, open: o, high: h, low: l, close: c });
  p = c;
}

const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://atlas.test/' });
const w = dom.window;
Object.defineProperty(w.document, 'hidden', { get: () => false });
w.candles = velas;
const linhas = [];
w.candleSeries = {
  createPriceLine: (o) => { const l = { ...o }; linhas.push(l); return l; },
  removePriceLine: () => {},
  data: () => velas.map(v => ({ time: v.time, close: v.close }))
};
w.chart = {};
w.AtlasFiboCore = fibo;
w.AtlasTrailingCore = { trailingStop: () => null, TRAILING_VERSION: '1.0.0' };

const s = w.document.createElement('script');
s.textContent = fs.readFileSync('trailing-atlas.js', 'utf8');
w.document.body.appendChild(s);
await new Promise(r => setTimeout(r, 700));

const plano = fibo.fiboPlan(velas.slice(0, -1).map(v => ({ t: v.time / 1, o: v.open, h: v.high, l: v.low, c: v.close })));
t('nucleo devolve plano', !!plano, 'null');
t('plano tem ancora p0 e p1', plano && isFinite(plano.p0) && isFinite(plano.p1));
t('plano tem cinco niveis', plano && plano.niveis.length === 5, plano && plano.niveis.length);

const alvos = linhas.filter(l => /0\.618|1\.618|2\.618|3\.618|4\.618/.test(String(l.title)));
t('desenhou os cinco alvos do pine', alvos.length === 5, alvos.length);
const esperado = plano.niveis.map(n => Math.abs(n.preco - 0) < 1e9);
t('precos das linhas batem com o nucleo', plano.niveis.every(n => alvos.some(l => Math.abs(l.price - n.preco) < 0.01)), JSON.stringify(alvos.map(a => a.price)));
t('rotulo diz alta ou baixa', alvos.every(l => /alta|baixa/.test(String(l.title))));
t('linha de ancora desenhada', linhas.some(l => /ancora/.test(String(l.title))));
t('nenhum nivel de retracao antigo', !linhas.some(l => /^fib 0\.382|^fib 0\.5|^fib 0$/.test(String(l.title))));
t('titulo do botao FIB atualizado', /FIB (alta|baixa)/.test(w.document.getElementById('ts-fib').title), w.document.getElementById('ts-fib').title);

console.log(falhas ? `\n${falhas} falhas` : `\n${ok} verificacoes do fib no preco passaram`);
dom.window.close();
process.exit(falhas ? 1 : 0);
