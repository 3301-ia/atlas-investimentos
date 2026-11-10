import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import * as coreTrailing from './trailing.js';

let ok = 0, falhas = 0;
function t(nome, cond, extra) { if (cond) { ok++; console.log('  ok  ' + nome); } else { falhas++; console.log('  FALHA ' + nome + (extra ? ' :: ' + extra : '')); } }

const html = `<!doctype html><html><body><div id="chart" style="width:800px;height:420px"><canvas></canvas></div></body></html>`;
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://atlas.test/' });
const w = dom.window;

const velas = Array.from({ length: 120 }, (_, i) => ({
  time: 1700000000 + i * 60,
  open: 100 + i * 0.4, high: 100.4 + i * 0.4, low: 99.6 + i * 0.4, close: 100 + i * 0.4, volume: 10
}));
w.candles = velas.slice(0, -1);
w.AtlasTrailingCore = coreTrailing;

let dadosTS = null;
w.chart = {
  addLineSeries: () => ({ setData: (d) => { dadosTS = d; } })
};
const linhas = [];
w.candleSeries = {
  createPriceLine: (o) => { linhas.push(o); return o; },
  removePriceLine: (l) => { const i = linhas.indexOf(l); if (i >= 0) linhas.splice(i, 1); }
};
w.fiboAtual = () => ({ type: 'fibbo', p0: { price: 160 }, p1: { price: 135 } });

const codigo = fs.readFileSync('trailing-atlas.js', 'utf8');
const s = w.document.createElement('script');
s.textContent = codigo;
w.document.body.appendChild(s);

await new Promise(r => setTimeout(r, 900));

t('chip do trailing criado', !!w.document.getElementById('ts-chip'));
t('serie do trailing recebeu dados', Array.isArray(dadosTS) && dadosTS.length > 20, dadosTS && dadosTS.length);
t('serie acompanha o tendao de alta', dadosTS && dadosTS[dadosTS.length-1].value < w.candles[w.candles.length-1].close);
const est = w.AtlasTrailing && w.AtlasTrailing.estado();
t('estado do trailing exposto', !!est && est.lado === 'alta');
t('chip mostra o stop', /\d/.test(w.document.getElementById('ts-val').textContent));
t('seis niveis de fib no preco', linhas.length === 6, linhas.length);
t('rotulo do fib correto', linhas.some(l => l.title === 'fib 0.618'));
t('cor do 0.618', (linhas.find(l => l.title === 'fib 0.618') || {}).color === '#009688');

w.document.getElementById('ts-fib').click();
t('botao FIB remove os niveis', linhas.length === 0, linhas.length);
w.document.getElementById('ts-fib').click();
t('botao FIB devolve os niveis', linhas.length === 6, linhas.length);

w.document.getElementById('ts-btn').click();
t('botao TS limpa a linha', Array.isArray(dadosTS) && dadosTS.length === 0);
w.document.getElementById('ts-btn').click();
t('botao TS devolve a linha', dadosTS.length > 20);

console.log(falhas ? '\n' + falhas + ' falhas' : '\n' + ok + ' verificacoes do trailing na tela passaram');
dom.window.close();
process.exit(falhas ? 1 : 0);
