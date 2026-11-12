import fs from 'node:fs';
import { JSDOM } from 'jsdom';

let ok = 0, falhas = 0;
const t = (nome, cond, extra) => { if (cond) { ok++; console.log('  ok  ' + nome); } else { falhas++; console.log('  FALHA ' + nome + (extra !== undefined ? ' :: ' + extra : '')); } };

const html = '<!doctype html><html><body><div class="sidebar"><div class="nav-item">Painel</div></div>' +
  '<span id="big-price">71.352,38</span></body></html>';

const ordem = {
  ok: true, ativo: 'BTC-USDT',
  aberta: { id: 'abc1', lado: 'venda', entrada: 71424.3, stop: 72428.09, alvo: 69416.72, tamanho: 0.0026,
    risco_usd: 2.6, timeframe: '1H', hash: '8b10b5d2b150ab0082cbbadd27f1c026', estado: 'aberta' },
  fechadas: [], resumo: { fechadas: 0, acerto_pct: null, resultado_usd: 0, resultado_r: 0 }
};

const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://atlas.test/' });
const w = dom.window;
let respostas = [ordem];
const avisos = [];
w.fetch = () => Promise.resolve({ json: () => Promise.resolve(respostas.shift() || ordem) });
w.showInfoToast = (m) => avisos.push(m);

const s = w.document.createElement('script');
s.textContent = fs.readFileSync('robo-ui.js', 'utf8');
w.document.body.appendChild(s);

const espera = (ms) => new Promise(r => setTimeout(r, ms));
await espera(400);

t('item Robo entrou na navegacao', !!w.document.getElementById('btn-robo'));
t('cartao criado', !!w.document.getElementById('robo-card'));
t('chip mostra a ordem', /V/.test(w.document.getElementById('robo-chip').textContent), w.document.getElementById('robo-chip').textContent);
t('leu a ordem do servidor', w.AtlasRobo.estado().dados && w.AtlasRobo.estado().dados.aberta.id === 'abc1');

await w.AtlasRobo.abrir();
await espera(200);
const txt = w.document.getElementById('robo-corpo').textContent;
t('cartao mostra VENDA', txt.includes('VENDA'));
t('cartao mostra stop e alvo', txt.includes('72.428,09') && txt.includes('69.416,72'));
t('cartao mostra risco', txt.includes('2,60'));
t('cartao mostra o hash', txt.includes('8b10b5d2b150ab00'));
t('cartao mostra R atual', /R/.test(txt));
t('cartao mostra temporada', txt.toLowerCase().includes('temporada'));

// ordem fechada aparecendo: precisa avisar
const fechada = {
  ok: true,
  aberta: null,
  fechadas: [{ id: 'abc1', lado: 'venda', entrada: 71424.3, preco_saida: 70000, resultado_r: 1.42, resultado_usd: 3.7, estado: 'fechada' }],
  resumo: { fechadas: 1, acerto_pct: 100, resultado_usd: 3.7, resultado_r: 1.42 }
};
w.AtlasRobo.conferir(fechada);
t('avisou o fechamento', avisos.some(a => /fechou/.test(a)), JSON.stringify(avisos));
t('aviso traz R e USD', avisos.some(a => /\+1\.42R/.test(a) && /3\.7/.test(a)));

// ordem nova
const nova = {
  ok: true,
  aberta: { id: 'abc2', lado: 'compra', entrada: 70000, stop: 69000, alvo: 72000, tamanho: 0.001, risco_usd: 1, timeframe: '1H', hash: 'ff' },
  fechadas: [], resumo: { fechadas: 0, acerto_pct: null, resultado_usd: 0, resultado_r: 0 }
};
w.AtlasRobo.conferir(nova);
t('avisou a ordem nova', avisos.some(a => /abriu COMPRA/.test(a)), JSON.stringify(avisos));

t('fechar esconde o cartao', (() => { w.AtlasRobo.fechar(); return w.document.getElementById('robo-card').style.display === 'none'; })());

console.log('\n' + ok + ' verificacoes do robo na tela passaram' + (falhas ? ' | ' + falhas + ' falhas' : ''));
dom.window.close();
