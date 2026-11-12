import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import * as core from './vigia.js';

let ok = 0, f = 0;
const t = (n, c, x) => { if (c) { ok++; console.log('  ok  ' + n); } else { f++; console.log('  FALHA ' + n + (x ? ' :: ' + x : '')); } };

const dom = new JSDOM('<!doctype html><html><body><div class="nav"><div class="nav-item">Inicio</div></div>' +
  '<span id="rt-price">$73.917,30</span></body></html>',
  { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://atlas.test/' });
const w = dom.window;
w.AtlasVigiaCore = core;
w.AtlasTrailing = { estado: () => ({ stop: 73450.5 }) };
const avisos = [];
w.showInfoToast = (a, b) => avisos.push(b);

const s = w.document.createElement('script');
s.textContent = fs.readFileSync('vigia-ui.js', 'utf8');
w.document.body.appendChild(s);

await new Promise(r => setTimeout(r, 100));
t('item Vigia na navegacao', !!w.document.getElementById('nav-vigia'));
w.document.getElementById('nav-vigia').click();
await new Promise(r => setTimeout(r, 200));
t('cartao abriu', !!w.document.getElementById('vg-card') && w.document.getElementById('vg-card').style.display === 'block');

const campos = w.document.querySelectorAll('#vg-card input');
t('quatro campos de numero', campos.length === 4, campos.length);
const [entrada, lote, stop, alvo] = campos;
entrada.value = '73136.264'; lote.value = '0.01'; stop.value = '73831.198'; alvo.value = '74317.122';
const botaoSalvar = Array.from(w.document.querySelectorAll('#vg-card button')).find(b => b.textContent === 'SALVAR');
botaoSalvar.click();
await new Promise(r => setTimeout(r, 150));

const a = w.AtlasVigia.ultima();
t('preco lido do painel', a && Math.abs(a.preco - 73917.30) < 0.02, a && a.preco);
t('lucro calculado', a && Math.abs(a.lucroUSD - 7.81) < 0.03, a && a.lucroUSD);
const saida = w.document.getElementById('vg-saida');
t('lucro aparece na tela', saida.textContent.includes('7,81'), saida.textContent.slice(0, 60));
t('estado do stop no lucro', w.document.getElementById('vg-estado').textContent.includes('STOP NO LUCRO'));
t('aviso disparado', avisos.length >= 1, avisos.join('|'));
t('posicao salva', JSON.parse(w.localStorage.getItem('atlas.vigia.v1')).entrada === 73136.264);

// preco cai para perto do stop sem lucro
w.document.getElementById('rt-price').textContent = '$73.850,00';
w.AtlasVigia.avaliar();
await new Promise(r => setTimeout(r, 60));
t('sem stop aparece quando limpar', (() => {
  const botaoLimpar = Array.from(w.document.querySelectorAll('#vg-card button')).find(b => b.textContent === 'LIMPAR');
  botaoLimpar.click();
  return w.document.getElementById('vg-saida').textContent.includes('informe entrada');
})());

// botao de usar stop do TS
entrada.value = '73000'; lote.value = '0.01'; stop.value = ''; alvo.value = '74000';
const botaoTS = Array.from(w.document.querySelectorAll('#vg-card button')).find(b => b.textContent.includes('USAR STOP'));
botaoTS.click();
await new Promise(r => setTimeout(r, 80));
t('stop sugerido preenchido', campos[2].value === '73450.50', campos[2].value);

console.log(f ? '\n' + f + ' falhas' : '\n' + ok + ' verificacoes do vigia na tela passaram');
dom.window.close();
process.exit(f ? 1 : 0);
