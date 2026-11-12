import fs from 'node:fs';
import { JSDOM } from 'jsdom';

let ok = 0, falhas = 0;
const t = (nome, cond, extra) => { if (cond) { ok++; console.log('  ok  ' + nome); } else { falhas++; console.log('  FALHA ' + nome + (extra ? ' :: ' + extra : '')); } };

const dom = new JSDOM('<!doctype html><html><body><nav><div class="nav-item">Painel</div></nav></body></html>',
  { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://atlas.test/' });
const w = dom.window;
Object.defineProperty(w.document, 'hidden', { get: () => false });

const abertaBase = {
  id: 'abc1', lado: 'venda', entrada: 71424.3, stop: 72428.09, alvo: 69416.72,
  tamanho: 0.0026, risco_usd: 2.6, risco_pct: 2, hash: '8b10b5d2b150ab00',
  aberta_em: '2026-11-12T20:34:16.755Z', estado: 'aberta', preco_mercado: 71424.3
};
let ordem = { ...abertaBase };
let fechadas = [];
let avisos = [];

w.fetch = (url) => Promise.resolve({
  ok: true,
  json: () => Promise.resolve(
    String(url).includes('robopapel_historico')
      ? { fechadas: fechadas.slice(), resumo: fechadas.length ? { fechadas: fechadas.length, acerto_pct: 50, resultado_r: 1.2, resultado_usd: 3.1 } : { fechadas: 0 } }
      : { aberta: ordem, preco: 71300, atualizado_em: '2026-11-12T20:44:00Z', estrutura: { lado: 'baixa' } }
  )
});
w.AudioContext = function () { return { createOscillator: () => ({ connect() {}, start() {}, stop() {}, frequency: { value: 0 } }), destination: {}, close() {} }; };
w.navigator.vibrate = () => true;
w.showInfoToast = (m) => avisos.push(m);
w.alert = (m) => avisos.push(m);

const s = w.document.createElement('script');
s.textContent = fs.readFileSync('robo-ui.js', 'utf8');
w.document.body.appendChild(s);
await new Promise(r => setTimeout(r, 900));

t('item Robo entrou na navegacao', !!w.document.getElementById('btn-robo'), 'nao achou');
t('cartao criado', !!w.document.getElementById('robo-card'));
t('chip mostra a ordem', /V/.test(w.document.getElementById('robo-chip').textContent), w.document.getElementById('robo-chip').textContent);
t('leu o JSON do site', w.AtlasRobo.estado().dados && w.AtlasRobo.estado().dados.aberta.id === 'abc1');

// abre o cartao pelo item da navegacao
w.document.getElementById('btn-robo').click();
await new Promise(r => setTimeout(r, 400));
const texto = w.document.getElementById('robo-corpo').textContent;
t('cartao mostra VENDA', /VENDA/.test(texto), texto.slice(0, 60));
t('cartao mostra stop e alvo', /72\.428/.test(texto) && /69\.416/.test(texto));
t('cartao mostra risco', /2,60|2\.6/.test(texto));
t('cartao mostra o hash', /8b10b5d2/.test(texto));
t('cartao mostra R atual', /R/.test(texto));
t('cartao abriu', w.document.getElementById('robo-card').style.display === 'block');

// fechamento da ordem
fechadas = [{ ...abertaBase, estado: 'fechada', preco_saida: 69416.72, resultado_r: 2, resultado_usd: 5.2, motivo_fechamento: 'alvo' }];
ordem = null;
w.AtlasRobo.ciclo();
await new Promise(r => setTimeout(r, 300));
t('avisou o fechamento', avisos.some(a => /fechou|alvo/i.test(a)), JSON.stringify(avisos).slice(0, 120));
t('aviso traz R e USD', avisos.some(a => /2/.test(a) && /5/.test(a)));

// ordem nova
ordem = { ...abertaBase, id: 'xyz9', lado: 'compra', entrada: 71500, stop: 71000, alvo: 72500 };
w.AtlasRobo.ciclo();
await new Promise(r => setTimeout(r, 300));
t('avisou a ordem nova', avisos.some(a => /abriu/i.test(a) && /COMPRA/.test(a)), JSON.stringify(avisos).slice(-1)[0]);

const btnFechar = Array.from(w.document.querySelectorAll('#robo-card button')).find(b => b.textContent === '×');
btnFechar.click();
t('fechar esconde o cartao', w.document.getElementById('robo-card').style.display === 'none');

console.log(`\n${ok} verificacoes do robo na tela passaram`);
if (falhas) { console.log(`${falhas} falhas`); }
// o cartao agenda um ciclo e um aviso: sai na mao para a prova terminar
dom.window.close();
process.exit(falhas ? 1 : 0);
