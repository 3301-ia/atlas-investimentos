// VECTRA · teste do painel da escada de travas
//
//   node atlas-ui/core/test-vectra-painel.mjs
//
// Precisa de jsdom (o mesmo usado pelos outros testes de tela). Sem ele, o
// teste avisa e sai sem falhar.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '..');

let JSDOM;
try {
  ({ JSDOM } = await import('jsdom'));
} catch {
  console.log('jsdom não instalado — teste do painel pulado.');
  process.exit(0);
}

let ok = 0, falhas = 0;
const t = (nome, cond, extra) => {
  if (cond) { ok++; console.log('  ok  ' + nome); }
  else { falhas++; console.log('  FALHA ' + nome + (extra ? ' :: ' + extra : '')); }
};

/* ── carregar os dois arquivos dentro de um DOM ───────────────────── */
function carregarBacktest(w) {
  const codigo = fs.readFileSync(path.join(RAIZ, 'vectra-backtest.js'), 'utf8');
  const sandbox = { module: { exports: {} }, console, globalThis: w, window: w };
  sandbox.exports = sandbox.module.exports;
  vm.createContext(sandbox);
  vm.runInContext(codigo, sandbox);
  return sandbox.module.exports.rodar ? sandbox.module.exports : w.VectraBacktest;
}

const dom = new JSDOM('<!doctype html><html><head></head><body><div id="robo-ciclos-card"></div></body></html>',
  { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://atlas.test/' });
const w = dom.window;

const B = carregarBacktest(w);
const velas = JSON.parse(fs.readFileSync(path.join(AQUI, 'dados', 'm15_btcusdt_15m.json'), 'utf8'))
  .map(v => ({ t: v[0], open: v[1], close: v[2], high: v[3], low: v[4], volume: v[5] }));
const resultado = B.rodar(velas);

// O robô de ciclos é quem produz os ciclos que o painel lê.
w.RoboCiclos = { estado: { teste: { ciclos: resultado.listaCiclos }, velas } };

const script = w.document.createElement('script');
script.textContent = fs.readFileSync(path.join(RAIZ, 'vectra-escada-painel.js'), 'utf8');
w.document.head.appendChild(script);

await new Promise(r => setTimeout(r, 300));
w.VectraEscadaPainel.atualizar();

const card = w.document.getElementById('escada-painel-card');
t('painel montou', !!card);
t('painel entrou na aba Ciclos', card && card.parentElement && card.parentElement.id === 'robo-ciclos-card',
  card && card.parentElement && card.parentElement.id);

if (card) {
  const texto = card.textContent;
  t('mostra o resultado do relatório', /684/.test(texto));
  t('mostra os níveis da escada', /0,33R/.test(texto) && /1,67R/.test(texto));
  t('mostra a conferência do relatório', /reprodução OK/i.test(texto));
  t('sem disjuntor disparado no estudo', /sistema operacional/i.test(texto));
  t('auditoria com 30 linhas + cabeçalho', card.querySelectorAll('.ep-audit tr').length === 31,
    String(card.querySelectorAll('.ep-audit tr').length));
  t('canvas de equity presente', !!card.querySelector('#ep-equity-canvas'));
  t('botão de exportar CSV presente', !!card.querySelector('#ep-export'));
}

/* ── decomposição e disjuntores direto na função ──────────────────── */
const m = w.VectraEscadaPainel.analisar(resultado.listaCiclos);
t('analisar: 599 ciclos', m.ciclos === 599, String(m.ciclos));
t('analisar: aberturas por nível iguais ao relatório',
  JSON.stringify(m.nivelAberturas) === JSON.stringify([388, 318, 241, 169, 103]),
  JSON.stringify(m.nivelAberturas));
t('analisar: decomposição 24,7% / 75,3%',
  Math.abs(m.totalPrincipal / m.total - 0.247) < 0.005 && Math.abs(m.totalTravas / m.total - 0.753) < 0.005,
  (m.totalPrincipal / m.total * 100).toFixed(1) + '% / ' + (m.totalTravas / m.total * 100).toFixed(1) + '%');
t('analisar: reserva de 10% = 68,45', Math.abs(m.reserva - 68.45) < 0.1, m.reserva.toFixed(2));
t('analisar: nenhum disjuntor no estudo', w.VectraEscadaPainel.disjuntores(m).length === 0);
t('analisar: aprovado no recorte do estudo', m.aprovado === true);

/* ── caso ruim dispara os disjuntores da seção 25 ─────────────────── */
const ruim = Array.from({ length: 20 }, () => ({
  lado: 1, entrada: 100, precoSaida: 99, motivo: 'stop',
  principal: -1, travas: -1, total: -2, r: -1,
  lista: [{ nivel: 1 / 3, estado: 'corte', resultado: -0.5 }],
}));
const mRuim = w.VectraEscadaPainel.analisar(ruim);
const acoes = w.VectraEscadaPainel.disjuntores(mRuim).map(d => d.acao);
t('acerto 0% desliga o sistema', acoes.some(a => /DESLIGAR e revisar/.test(a)), acoes.join(' | '));
t('nível 1 fraco pede revisão do alvo', acoes.some(a => /Revisar o alvo/.test(a)), acoes.join(' | '));
t('sequência de perdas pede pausa', acoes.some(a => /Pausar e revisar/.test(a)), acoes.join(' | '));
t('não aprova tamanho real', mRuim.aprovado === false);

/* ── acerto na faixa de alerta reduz lote, não desliga ────────────── */
const alerta = Array.from({ length: 100 }, (_, i) => ({
  lado: 1, entrada: 100, precoSaida: i < 30 ? 101 : 99, motivo: i < 30 ? 'alvo' : 'stop',
  principal: i < 30 ? 1 : -0.1, travas: 0, total: i < 30 ? 1 : -0.1,
  r: i < 30 ? 1 : -0.1, lista: [],
}));
const mAlerta = w.VectraEscadaPainel.analisar(alerta);
const acoesAlerta = w.VectraEscadaPainel.disjuntores(mAlerta).map(d => d.acao);
t('acerto 30% reduz o lote pela metade', acoesAlerta.some(a => /Reduzir lote/.test(a)), acoesAlerta.join(' | '));
t('acerto 30% não desliga', !acoesAlerta.some(a => /DESLIGAR/.test(a)), acoesAlerta.join(' | '));

console.log('\n' + ok + ' ok, ' + falhas + ' falha(s)');
process.exit(falhas === 0 ? 0 : 1);
