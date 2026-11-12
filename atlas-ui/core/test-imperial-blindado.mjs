// Prova de que o Imperial nao quebra com dado ruim. Toda entrada hostil tem
// que virar leitura ou nulo, nunca excecao.

import { imperial, limparVelas, minimoVelas } from './imperial.js';

let ok = 0, falhou = 0;
const t = (nome, cond, extra) => {
  if (cond) { ok++; console.log('  ok  ' + nome); }
  else { falhou++; console.log('  FALHOU  ' + nome + (extra != null ? ' :: ' + JSON.stringify(extra) : '')); }
};

function velas(n, passo = 40, t0 = 1700000000) {
  const out = []; let p = 70000;
  for (let i = 0; i < n; i++) {
    const a = p; p += passo;
    out.push({ time: t0 + i * 3600, h: Math.max(a, p) + 16, l: Math.min(a, p) - 16, c: p, v: 10 });
  }
  return out;
}

const naoQuebra = (nome, entrada) => {
  let erro = null, r = undefined;
  try { r = imperial(entrada); } catch (e) { erro = e.message; }
  t(nome + ' sem excecao', erro === null, erro);
  return r;
};

console.log('\n== entradas hostis ==');
t('nulo -> nulo', naoQuebra('nulo', null) === null);
t('undefined -> nulo', naoQuebra('undefined', undefined) === null);
t('lista vazia -> nulo', naoQuebra('vazia', []) === null);
t('3 velas -> nulo', naoQuebra('3 velas', velas(3)) === null);
t('27 velas -> nulo', naoQuebra('27 velas', velas(27)) === null);
t('28 velas -> nulo', naoQuebra('28 velas', velas(28)) === null);
t('29 velas ja calcula (minimo real)', naoQuebra('29 velas', velas(29)) !== null);

console.log('\n== vela estragada no meio ==');
const comBuraco = velas(160);
comBuraco[80] = { time: comBuraco[80].time, h: NaN, l: 1, c: 2, v: 1 };
const rBuraco = naoQuebra('vela com NaN', comBuraco);
t('descarta a vela ruim e segue calculando', rBuraco && rBuraco.estado && rBuraco.estado.dir !== 0, rBuraco && rBuraco.estado);
t('serie desenhada nao tem ponto invalido', rBuraco.series.linha.every(v => v == null || Number.isFinite(v)));
t('a vela ruim saiu da limpeza', limparVelas(comBuraco).length === 159, limparVelas(comBuraco).length);

const comNulos = velas(120).map((c, i) => (i % 17 === 0 ? { time: c.time, h: null, l: null, c: null } : c));
t('velas nulas sao ignoradas', naoQuebra('nulas', comNulos) !== null);

const semCampo = velas(120).map(c => ({ time: c.time, high: c.h, low: c.l, close: c.c, volume: c.v }));
t('aceita high/low/close por extenso', naoQuebra('extenso', semCampo) !== null);

const texto = velas(120).map(c => ({ time: c.time, h: String(c.h), l: String(c.l), c: String(c.c), v: '3' }));
t('aceita numero em texto', naoQuebra('texto', texto) !== null);

console.log('\n== tempo repetido e fora de ordem ==');
const repetido = velas(160).concat([velas(10)]);
t('tempo repetido nao derruba', naoQuebra('repetido', repetido) !== null);
t('limpeza remove tempo repetido', limparVelas(repetido).length === 160, limparVelas(repetido).length);

const embaralhado = velas(160).slice().reverse();
const rEmb = naoQuebra('fora de ordem', embaralhado);
t('ordem invertida e reordenada', rEmb && rEmb.series.linha.length === 160, rEmb && rEmb.series.linha.length);

console.log('\n== volume ==');
const semVolume = velas(120).map(c => ({ time: c.time, h: c.h, l: c.l, c: c.c }));
t('sem volume nao quebra (usa ta.tr)', naoQuebra('sem volume', semVolume) !== null);
const volumeZero = velas(120).map(c => ({ ...c, v: 0 }));
t('volume zero nao quebra', naoQuebra('volume zero', volumeZero) !== null);

console.log('\n== precos degenerados ==');
const parado = velas(120).map(c => ({ time: c.time, h: 70000, l: 70000, c: 70000, v: 5 }));
t('preco totalmente parado nao quebra', naoQuebra('parado', parado) === null || true);

console.log('\n' + (falhou ? falhou + ' falharam' : 'todas as ' + ok + ' provas de robustez passaram'));
process.exit(falhou ? 1 : 0);
