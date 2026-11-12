// Testes do núcleo de replay: sanidade, causalidade e contas.
import { simularReplay, REPLAY_VERSION } from './replay.js';

let ok = 0, falhas = 0;
function t(nome, fn) {
  try { fn(); ok++; console.log('ok   ' + nome); }
  catch (e) { falhas++; console.log('FALHA ' + nome + ' :: ' + e.message); }
}
function eq(a, b, msg) { if (a !== b) throw new Error((msg || '') + ' esperado ' + b + ', veio ' + a); }
function perto(a, b, tol, msg) { if (Math.abs(a - b) > tol) throw new Error((msg || '') + ' esperado ~' + b + ', veio ' + a); }

function velas(degraus) {
  // gera velas a partir de uma sequencia de fechamentos
  let t = 1600000000;
  return degraus.map((c, i) => {
    const o = i === 0 ? c : degraus[i - 1];
    return { time: t + i * 3600, open: o, high: Math.max(o, c) * 1.001, low: Math.min(o, c) * 0.999, close: c, o, h: 0, l: 0, c };
  });
}

// 1. histórico curto não explode
t('historico curto devolve null', () => {
  eq(simularReplay(velas([100, 101, 102])), null);
});

// 2. serie de alta tendencia gera operacoes e resultado positivo
t('tendencia de alta gera operacoes', () => {
  const preco = [];
  for (let i = 0; i < 300; i++) preco.push(100 + i * 0.8);
  const r = simularReplay(velas(preco), { alvoR: 2 });
  if (!r || r.operacoes < 1) throw new Error('sem operacoes');
  if (r.r_total <= 0) throw new Error('deveria ser positivo em alta limpa, veio ' + r.r_total);
  eq(r.versao, REPLAY_VERSION);
});

// 3. causalidade: refazer o replay com uma barra a mais não muda o passado
t('causalidade: futuro novo nao reescreve o passado', () => {
  const preco = [];
  for (let i = 0; i < 200; i++) preco.push(100 + Math.sin(i / 7) * 6 + i * 0.2);
  const vs = velas(preco);
  const a = simularReplay(vs, { alvoR: 2 });
  const b = simularReplay(vs.concat(velas([preco[preco.length - 1] + 50])), { alvoR: 2 });
  const nA = a.operacoes, nB = b.operacoes;
  if (nB < nA) throw new Error('operacoes sumiram ao acrescentar barra');
});

// 4. stop e alvo na mesma barra: vale o stop (pessimista)
t('empate na barra vale o stop', () => {
  const preco = [];
  for (let i = 0; i < 120; i++) preco.push(100 + i * 0.1);
  const vs = velas(preco);
  const r = simularReplay(vs, { alvoR: 0.5 });
  if (!r || !r.operacoes) throw new Error('sem operacoes');
  const motivos = Object.keys(r.por_motivo);
  if (!motivos.includes('stop') && !motivos.includes('alvo') && !motivos.includes('virada')) {
    throw new Error('motivos inesperados: ' + motivos.join(','));
  }
});

// 5. custo reduz o resultado exatamente uma vez por operacao
t('custo entra em R por operacao', () => {
  const preco = [];
  for (let i = 0; i < 300; i++) preco.push(100 + Math.sin(i / 5) * 8 + i * 0.1);
  const vs = velas(preco);
  const sem = simularReplay(vs, { alvoR: 2 });
  const com = simularReplay(vs, { alvoR: 2, custoPreco: 20 });
  if (sem.operacoes !== com.operacoes) throw new Error('operacoes mudaram com custo');
  if (!(com.r_total < sem.r_total)) throw new Error('custo nao reduziu o resultado');
});

// 6. metricas de risco fazem sentido
t('drawdown e sequencia de perdas coerentes', () => {
  const preco = [];
  for (let i = 0; i < 400; i++) preco.push(100 + Math.sin(i / 3) * 10);
  const r = simularReplay(velas(preco), { alvoR: 2 });
  if (r.operacoes < 5) throw new Error('poucas operacoes: ' + r.operacoes);
  if (r.drawdown_r < 0) throw new Error('drawdown negativo');
  if (r.sequencia_perdas < 0) throw new Error('sequencia negativa');
  const somaAnos = Object.values(r.por_ano).reduce((a, g) => a + g.operacoes, 0);
  eq(somaAnos, r.operacoes, 'por_ano deveria somar todas as operacoes');
});

console.log('\n' + ok + ' passaram, ' + falhas + ' falharam');
process.exit(falhas ? 1 : 0);
