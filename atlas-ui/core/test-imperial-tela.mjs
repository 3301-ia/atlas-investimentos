// Prova do Imperial na tela: cartao abre, le as velas do painel, desenha as
// linhas no grafico e desliga sem deixar lixo.
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import * as core from './imperial.js';

let ok = 0, f = 0;
const t = (n, c, x) => { if (c) { ok++; console.log('  ok  ' + n); } else { f++; console.log('  FALHA ' + n + (x ? ' :: ' + x : '')); } };

const dom = new JSDOM('<!doctype html><html><body><div class="nav"><div class="nav-item">Inicio</div></div></body></html>',
  { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://atlas.test/' });
const w = dom.window;
w.AtlasImperialCore = core;

// velas sinteticas de alta, do jeito que o painel entrega
const velas = [];
let p = 70000;
for (let i = 0; i < 200; i++) {
  const abre = p; p += 40;
  velas.push({ time: 1700000000 + i * 3600, open: abre, high: Math.max(abre, p) + 20, low: Math.min(abre, p) - 20, close: p, volume: 15 });
}
w.candles = velas;

// grafico de mentira que anota o que foi desenhado
const seriesCriadas = [];
w.chart = {
  addLineSeries(opts) {
    const s = { opts, dados: [], setData(d) { this.dados = d; }, removida: false };
    seriesCriadas.push(s);
    return s;
  },
  removeSeries(s) { s.removida = true; }
};

const logs = [];
w.console.log = (...a) => logs.push(a.join(' '));

const s = w.document.createElement('script');
s.textContent = fs.readFileSync('imperial-ui.js', 'utf8');
w.document.body.appendChild(s);

await new Promise(r => setTimeout(r, 120));
t('item Imperial na navegacao', !!w.document.getElementById('nav-imperial'));
w.document.getElementById('nav-imperial').click();
await new Promise(r => setTimeout(r, 250));
t('cartao abriu', !!w.document.getElementById('imperial-card') && w.document.getElementById('imperial-card').style.display === 'block');

const cartao = w.document.getElementById('imperial-card');
t('cartao mostra o lado', /ALTA|BAIXA/.test(cartao.textContent), cartao.textContent.slice(0, 80));
t('cartao mostra o angulo', /ANGULO/.test(cartao.textContent));
t('cartao mostra os tres alvos', (cartao.textContent.match(/ALVO 70|EQUILIBRIO 50|ALVO 30/g) || []).length === 3);
t('cartao mostra o fluxo macro', /FLUXO 1H\/1D/.test(cartao.textContent));

const est = w.AtlasImperial.estado();
t('estado lido do nucleo', est && est.dir === 1, est && est.dir);
t('linha abaixo do preco na alta', est && est.linha < velas[velas.length - 1].close);

// ligar as linhas do grafico
const botaoLinhas = Array.from(cartao.querySelectorAll('button')).find(b => b.textContent === 'LINHAS');
botaoLinhas.click();
await new Promise(r => setTimeout(r, 250));
t('criou quatro series', seriesCriadas.length === 4, seriesCriadas.length);
const comDados = seriesCriadas.filter(s => s.dados.length > 0);
t('todas as series receberam dados', comDados.length === 4, comDados.length);
t('serie do supertrend tem ponto colorido', seriesCriadas[0].dados.every(d => d.color === '#00E676' || d.color === '#FF1744'));
t('alvo 70 tem a mesma quantidade de pontos que o alvo 30',
  seriesCriadas[1].dados.length === seriesCriadas[3].dados.length);
t('estado salvo ligado', JSON.parse(w.localStorage.getItem('atlas.imperial.v1')).ligado === true);

// leitura celula por celula
const botaoLivro = Array.from(cartao.querySelectorAll('button')).find(b => b.textContent === 'LIVRO');
botaoLivro.click();
t('livro escreve a leitura', logs.some(l => l.indexOf('[imperial] dir=') === 0), logs.slice(-1)[0]);

// desligar tira tudo do grafico
botaoLinhas.click();
await new Promise(r => setTimeout(r, 200));
t('desligar remove as series', seriesCriadas.every(s => s.removida === true));
t('estado salvo desligado', JSON.parse(w.localStorage.getItem('atlas.imperial.v1')).ligado === false);

// fechar o cartao
Array.from(cartao.querySelectorAll('button')).find(b => b.textContent === '\u00d7').click();
t('fechar esconde o cartao', cartao.style.display === 'none');

// sem velas nao quebra
w.candles = [];
w.AtlasImperial.abrir();
await new Promise(r => setTimeout(r, 150));
t('sem velas avisa em vez de quebrar', /sem velas/.test(w.document.getElementById('imperial-card').textContent));

console.log(f ? '\n' + f + ' falhas' : '\n' + ok + ' verificacoes do imperial na tela passaram');
dom.window.close();
process.exit(f ? 1 : 0);
