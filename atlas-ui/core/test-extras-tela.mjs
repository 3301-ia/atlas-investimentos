import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import * as macdCore from './macd.js';
import * as bollCore from './bollinger.js';

let ok = 0, f = 0;
const t = (n, c, x) => { if (c) { ok++; console.log('  ok  ' + n); } else { f++; console.log('  FALHA ' + n + (x ? ' :: ' + x : '')); } };

const html = `<!doctype html><html><body><div class="chart-wrap"><div id="chart"></div></div></body></html>`;
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://atlas.test/' });
const w = dom.window;

w.candles = Array.from({ length: 140 }, (_, i) => ({
  time: 1700000000 + i * 60, open: 100 + i, high: 101 + i, low: 99 + i, close: 100 + i, volume: 5
}));

const seriesCriadas = [];
function fakeSeries(tipo) {
  const s = { tipo, dados: [], setData: (d) => { s.dados = d; } };
  seriesCriadas.push(s);
  return s;
}
let paneCriado = null;
w.LightweightCharts = {
  createChart: (el) => {
    paneCriado = el;
    return {
      addHistogramSeries: () => fakeSeries('hist'),
      addLineSeries: () => fakeSeries('linha'),
      timeScale: () => ({ subscribeVisibleLogicalRangeChange: () => {}, fitContent: () => {} })
    };
  }
};
const bbSeries = { superior: fakeSeries('bb+'), media: fakeSeries('bb='), inferior: fakeSeries('bb-') };
let n = 0;
w.chart = { addLineSeries: () => bbSeries[['superior', 'media', 'inferior'][n++ % 3]] };
w.syncTimeScales = () => {};
w.AtlasMacdCore = macdCore;
w.AtlasBollCore = bollCore;
w.INDICATORS_REGISTRY = [];

const s = w.document.createElement('script');
s.textContent = fs.readFileSync('indicadores-extra.js', 'utf8');
w.document.body.appendChild(s);

await new Promise(r => setTimeout(r, 700));

const reg = w.INDICATORS_REGISTRY;
t('registrou os dois indicadores', reg.length === 2, reg.length);
t('id do bollinger', reg.some(x => x.id === 'bollinger-atlas' && x.category === 'overlay'));
t('id do macd', reg.some(x => x.id === 'macd-atlas' && x.category === 'subpane'));
t('catalogo vai de 28 para 30', 28 + reg.length === 30);

const bbEnt = reg.find(x => x.id === 'bollinger-atlas');
bbEnt.toggle();
await new Promise(r => setTimeout(r, 250));
t('ligar bollinger desenha 3 series', bbSeries.superior.dados.length > 20, bbSeries.superior.dados.length);
t('isLigado do bollinger', bbEnt.isLigado() === true);
t('preco da banda coerente com o candle', (() => {
  const ultimo = bbSeries.superior.dados[bbSeries.superior.dados.length - 1];
  return ultimo && ultimo.value > 100 && ultimo.value < 400;
})(), JSON.stringify(bbSeries.superior.dados.slice(-1)));

const mcEnt = reg.find(x => x.id === 'macd-atlas');
mcEnt.toggle();
await new Promise(r => setTimeout(r, 250));
t('painel do macd criado', !!w.document.getElementById('macd-chart'), !!paneCriado);
t('painel do macd visivel quando ligado', w.document.getElementById('macd-wrap').style.display === 'block');
const hist = seriesCriadas.find(x => x.tipo === 'hist');
t('histograma com dados', hist && hist.dados.length > 20, hist && hist.dados.length);
t('histograma colorido por sinal', hist && hist.dados.every(d => d.color.includes('rgba')));
const linhaMacd = seriesCriadas.filter(x => x.tipo === 'linha')[0];
t('linha do macd com dados', linhaMacd && linhaMacd.dados.length > 20);

t('legenda apareceu', (() => {
  const el = w.document.getElementById('extras-legenda');
  return el && el.style.display === 'block' && el.textContent.includes('MACD');
})());

bbEnt.toggle();
await new Promise(r => setTimeout(r, 200));
t('desligar bollinger limpa as series', bbSeries.superior.dados.length === 0);
mcEnt.toggle();
t('desligar macd esconde o painel', w.document.getElementById('macd-wrap').style.display === 'none');
t('estado salvo no localStorage', JSON.parse(w.localStorage.getItem('atlas.extras.v1')).macd === false);

console.log(f ? '\n' + f + ' falhas' : '\n' + ok + ' verificacoes dos extras na tela passaram');
dom.window.close();
process.exit(f ? 1 : 0);
