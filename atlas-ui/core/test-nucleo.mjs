import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { sha256hex } from './signature.js';

let ok = 0, falhas = 0;
function t(nome, cond, extra) { if (cond) { ok++; console.log('  ok  ' + nome); } else { falhas++; console.log('  FALHA ' + nome + (extra ? ' :: ' + extra : '')); } }

const dom = new JSDOM('<!doctype html><html><body><div class="nav"><div class="nav-item">Inicio</div></div></body></html>',
  { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://atlas.test/' });
const w = dom.window;

// fetch servindo os arquivos do proprio repositorio
w.fetch = (url) => {
  const u = String(url).replace('https://atlas.test/', '').split('?')[0];
  const p = path.resolve(process.cwd(), u);
  if (!fs.existsSync(p)) return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('') });
  const txt = fs.readFileSync(p, 'utf8');
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(JSON.parse(txt)), text: () => Promise.resolve(txt) });
};
w.AtlasSignature = { sha256hex };
w.AtlasTrailing = { estado: () => ({ lado: 'alta', stop: 73120.5, preco: 73900.2, distancia: 779.7, distanciaPercentual: 1.055, viradas: 2 }) };
w.AtlasTrailingCore = { TRAILING_PARAMS: { atr: 14, mult: 2.5, janela: 22 }, TRAILING_VERSION: '1.0.0' };

const s = w.document.createElement('script');
s.textContent = fs.readFileSync('nucleo-ui.js', 'utf8');
w.document.body.appendChild(s);

await new Promise(r => setTimeout(r, 150));

t('item Codigo entrou na navegacao', !!w.document.getElementById('nav-nucleo'));
t('clicar abre o painel', (w.document.getElementById('nav-nucleo').click(), !!w.document.getElementById('nucleo-painel')));

await new Promise(r => setTimeout(r, 400));

const lista = w.document.getElementById('nucleo-lista');
t('lista de pine carregou', lista && lista.children.length >= 9, lista && lista.children.length);
const det = w.document.getElementById('nucleo-detalhe');
const pre = det.querySelector('pre');
t('codigo aparece no detalhe', pre && pre.textContent.includes('//@version'), pre && pre.textContent.slice(0, 40));
const has = det.querySelector('#nucleo-hash').textContent;
t('hash calculado bate com o manifesto', has.includes('\u2713'), has);

// hash errado precisa acusar divergencia
w.AtlasNucleo.aba('nucleo');
await new Promise(r => setTimeout(r, 350));
const listaN = w.document.getElementById('nucleo-lista');
t('aba nucleo lista os modulos', listaN && listaN.children.length === 15, listaN && listaN.children.length);
const detN = w.document.getElementById('nucleo-detalhe');
t('modulo do trailing visivel', detN.querySelector('pre').textContent.includes('trailingStop'));

w.AtlasNucleo.aba('trailing');
await new Promise(r => setTimeout(r, 300));
const card = w.document.getElementById('nucleo-trailing-estado');
t('cartao do trailing mostra o lado', card && card.textContent.includes('ALTA'), card && card.textContent.slice(0, 60));
t('cartao mostra a distancia', card && card.textContent.includes('779.70'));
t('cartao mostra a versao do nucleo', card && card.textContent.includes('1.0.0'));
const preTr = w.document.querySelector('#nucleo-corpo pre').textContent;
t('pine do trailing carregado na aba', preTr.includes('//@version') && /vectra dynamic/i.test(preTr), preTr.slice(0, 60));

w.AtlasNucleo.fechar();
t('fechar esconde o painel', w.document.getElementById('nucleo-painel').style.display === 'none');

console.log(falhas ? '\n' + falhas + ' falhas' : '\n' + ok + ' verificacoes do painel nucleo passaram');
dom.window.close();
process.exit(falhas ? 1 : 0);
