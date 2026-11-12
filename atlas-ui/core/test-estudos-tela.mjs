import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import * as viradas from './viradas.js';
import * as giro from './giro.js';
import * as risco from './risco.js';

let ok = 0, f = 0;
const t = (n, c, x) => { if (c) { ok++; console.log('  ok  ' + n); } else { f++; console.log('  FALHA ' + n + (x ? ' :: ' + x : '')); } };

const dom = new JSDOM('<!doctype html><html><body><div class="nav"><div class="nav-item">Inicio</div></div></body></html>',
  { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://atlas.test/' });
const w = dom.window;

// 300 velas de 15 minutos
w.candles = Array.from({ length: 300 }, (_, i) => {
  const c = 73000 + Math.sin(i / 9) * 180 + i * 0.8;
  return { time: 1700000000 + i * 900, open: c - 20, high: c + 45, low: c - 45, close: c, volume: 3 };
});
w.AtlasViradasCore = viradas;
w.AtlasGiroCore = giro;
w.AtlasRiscoCore = risco;

const s = w.document.createElement('script');
s.textContent = fs.readFileSync('estudos-ui.js', 'utf8');
w.document.body.appendChild(s);

await new Promise(r => setTimeout(r, 120));
t('item Estudos na navegacao', !!w.document.getElementById('nav-estudos'));
w.document.getElementById('nav-estudos').click();
await new Promise(r => setTimeout(r, 350));
t('painel abriu', !!w.document.getElementById('estudos-painel') && w.document.getElementById('estudos-painel').style.display === 'flex');

// VIRADAS
const vr = w.AtlasEstudos.resultado().viradas;
t('medidor rodou em 1H e 4H', Array.isArray(vr) && vr.length === 2, vr && vr.length);
t('1H medido', vr && vr[0] && vr[0].r && vr[0].r.totalViradas > 0, vr && vr[0] && vr[0].r && vr[0].r.totalViradas);
t('4H informa falta de historico quando nao cabe', vr && vr[1] && (vr[1].r !== null || /precisa de 41/.test(w.document.getElementById('estudos-viradas-saida').textContent)));
t('tela mostra o liquido em ATR', w.document.getElementById('estudos-viradas-saida').textContent.includes('ATR'));

// SIMULADOR
w.AtlasEstudos.aba('simulador');
await new Promise(r => setTimeout(r, 200));
const sim = w.AtlasEstudos.resultado().simulador;
t('simulador rodou', sim && sim.mediana > 0, sim && sim.mediana);
t('tela mostra mediana final', w.document.getElementById('estudos-sim-saida').textContent.includes('mediana final'));
t('mostra ruina', w.document.getElementById('estudos-sim-saida').textContent.includes('ruina'));

// muda para espelhado no select e simula
const sel = w.document.querySelector('#estudos-corpo select');
sel.value = 'espelhado';
const botaoSim = Array.from(w.document.querySelectorAll('#estudos-corpo button')).find(b => b.textContent === 'SIMULAR');
botaoSim.click();
await new Promise(r => setTimeout(r, 150));
t('espelhado simulado', w.AtlasEstudos.resultado().simulador.parametros.modo === 'espelhado');
t('tela diz ESPELHADO', w.document.getElementById('estudos-sim-saida').textContent.includes('ESPELHADO'));

// RISCO
w.AtlasEstudos.aba('risco');
await new Promise(r => setTimeout(r, 200));
const rk = w.AtlasEstudos.resultado().risco;
t('dimensionamento calculado', rk && rk.dim && rk.dim.ok === true, rk && rk.dim && rk.dim.motivos);
t('tamanho positivo', rk.dim.tamanho > 0);
t('disjuntores liberados sem posicao', rk.dj.liberado === true, rk.dj.travas.join('|'));
t('folga diaria calculada', rk.folga && rk.folga.restanteUSD >= 0);
t('tela mostra TAMANHO e DISJUNTORES', (() => {
  const txt = w.document.getElementById('estudos-risco-saida').textContent;
  return txt.includes('TAMANHO') && txt.includes('DISJUNTORES');
})());

// stop vazio precisa recusar
const campos = w.document.querySelectorAll('#estudos-corpo input');
campos[3].value = '';
const botaoCalc = Array.from(w.document.querySelectorAll('#estudos-corpo button')).find(b => b.textContent === 'CALCULAR');
botaoCalc.click();
await new Promise(r => setTimeout(r, 120));
t('sem stop recusa e explica', /stop obrigatorio/.test(w.document.getElementById('estudos-risco-saida').textContent));

w.AtlasEstudos.fechar();
t('fechar esconde', w.document.getElementById('estudos-painel').style.display === 'none');

console.log(f ? '\n' + f + ' falhas' : '\n' + ok + ' verificacoes de estudos na tela passaram');
dom.window.close();
process.exit(f ? 1 : 0);
